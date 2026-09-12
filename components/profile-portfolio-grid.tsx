import { MaterialIcons } from '@expo/vector-icons';
import { VideoView, useVideoPlayer } from 'expo-video';
import { usePortfolioUpload } from 'hooks/use-portfolio-upload';
import { useAuthProfile } from 'hooks/useAuthProfile';
import { useNormalizedProfile } from 'hooks/useNormalizedProfile';
import { usePortfolio } from 'hooks/usePortfolio';
import { OptimizedImage } from 'lib/components/OptimizedImage';
import { MAX_PORTFOLIO_ITEMS, portfolioService } from 'lib/services/portfolio-service';
import type { PortfolioItem } from 'lib/types';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAppThemeContext } from '../lib/themes/AppThemeContext';
import type { AppTheme } from '../lib/themes/types';

/**
 * The portfolio, wired for the profile's tab strip.
 *
 * The data lives in a hook of its own because the tab bar needs the item count
 * to label the tab before the pane it belongs to is ever rendered, and the
 * upload flow has to survive a swipe to another tab.
 *
 * `userId` follows the same resolution the standalone portfolio section used —
 * pass undefined for the signed-in user's own profile so the normalized profile
 * resolves the id, which is the key the portfolio store is written under.
 */
export function useProfilePortfolio(userId?: string) {
  const { profile: normalizedProfile } = useNormalizedProfile(userId);
  const { profile: authProfile } = useAuthProfile();
  const resolvedUserId = normalizedProfile?.id || userId || authProfile?.id || 'current-user';

  const { items, loading, deleteItem, addItem, refresh } = usePortfolio(resolvedUserId);

  const upload = usePortfolioUpload({
    userId: resolvedUserId,
    onUploaded: async item => {
      // Storage accepted the file (that's what fires this callback), but the
      // portfolio_items row can still fail on its own — RLS, network. Without
      // this check that failure is silent: addItem reverts the optimistic item
      // and the upload just disappears.
      const saved = await addItem({
        ...item,
        id: undefined as any,
        createdAt: undefined as any,
      } as any);
      if (!saved) {
        Alert.alert(
          "Couldn't save that item",
          'Your file uploaded, but we could not add it to your portfolio. Please try again.'
        );
        return;
      }
      try {
        await refresh();
      } catch (e) {
        /* ignore */
      }
    },
  });

  return { resolvedUserId, items, loading, deleteItem, refresh, upload };
}

export type ProfilePortfolio = ReturnType<typeof useProfilePortfolio>;

function usePortfolioVideoPlayer(item: PortfolioItem | null) {
  const source = useMemo(() => {
    if (item?.type === 'video' && item.url) {
      return { uri: item.url };
    }
    return null;
  }, [item]);
  const player = useVideoPlayer(source, playerInstance => {
    playerInstance.pause();
    playerInstance.loop = false;
    playerInstance.muted = false;
    playerInstance.volume = 1;
  });
  useEffect(() => {
    if (!item || item.type !== 'video') {
      player.pause();
      return;
    }
    const subscription = player.addListener('statusChange', ({ status, error }) => {
      if (status === 'error' && error) {
        console.error('[Portfolio] Video playback error:', error);
      }
    });
    return () => subscription.remove();
  }, [item, player]);
  return { player, hasVideo: !!source };
}

interface PortfolioGridProps {
  portfolio: ProfilePortfolio;
  isOwnProfile: boolean;
  /** Square tile edge, sized by the pane so the columns line up with the other tabs. */
  tileWidth: number;
}

/**
 * The portfolio as a three-up grid, so it reads as one shelf with the completed
 * and posted tabs beside it. Deliberately not the horizontal carousel the
 * standalone section used: inside the pager a sideways scroller would swallow
 * the swipe that moves between tabs.
 */
export function PortfolioGrid({ portfolio, isOwnProfile, tileWidth }: PortfolioGridProps) {
  const { theme } = useAppThemeContext();
  const styles = useMemo(() => makeStyles(theme, tileWidth), [theme, tileWidth]);
  const { resolvedUserId, items, loading, deleteItem, refresh, upload } = portfolio;
  const { pickAndUpload, isPicking, isUploading, progress, message: uploadMessage, lastPicked } = upload;

  const [selectedItem, setSelectedItem] = useState<PortfolioItem | null>(null);
  const [isReordering, setIsReordering] = useState(false);
  const { player: videoPlayer, hasVideo } = usePortfolioVideoPlayer(selectedItem);

  const handleDelete = (itemId: string) => {
    Alert.alert('Delete item', 'Are you sure you want to delete this portfolio item?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteItem(itemId);
        },
      },
    ]);
  };

  const move = async (index: number, delta: number) => {
    const newOrder = [...items];
    const target = index + delta;
    [newOrder[index], newOrder[target]] = [newOrder[target], newOrder[index]];
    await portfolioService.reorderItems(
      resolvedUserId,
      newOrder.map(i => i.id)
    );
    await refresh();
  };

  // The just-picked asset renders from its local uri while the upload is in
  // flight, so the grid reacts to the tap immediately.
  const optimistic: PortfolioItem | null = lastPicked
    ? ({
        id: lastPicked.id,
        userId: resolvedUserId,
        type: lastPicked.kind === 'video' ? 'video' : lastPicked.kind === 'image' ? 'image' : 'file',
        url: lastPicked.uri,
        thumbnail: lastPicked.kind === 'image' ? lastPicked.uri : undefined,
        name: lastPicked.name,
        createdAt: new Date().toISOString(),
      } as PortfolioItem)
    : null;
  const visibleItems = optimistic ? [optimistic, ...items] : items;

  return (
    <View style={styles.wrap}>
      {isOwnProfile && (
        <View style={styles.actionRow}>
          <Text style={styles.countText}>
            {items.length}/{MAX_PORTFOLIO_ITEMS} items
          </Text>
          <View style={styles.actionButtons}>
            {items.length > 1 && (
              <TouchableOpacity
                style={[styles.secondaryButton, isReordering && styles.secondaryButtonActive]}
                onPress={() => setIsReordering(!isReordering)}
                accessibilityRole="button"
                accessibilityLabel={isReordering ? 'Done reordering' : 'Reorder portfolio items'}
              >
                <Text
                  style={[
                    styles.secondaryButtonText,
                    isReordering && styles.secondaryButtonTextActive,
                  ]}
                >
                  {isReordering ? 'Done' : 'Reorder'}
                </Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[
                styles.primaryButton,
                items.length >= MAX_PORTFOLIO_ITEMS && styles.primaryButtonDisabled,
              ]}
              onPress={pickAndUpload}
              disabled={isPicking || isUploading || items.length >= MAX_PORTFOLIO_ITEMS}
              accessibilityRole="button"
              accessibilityLabel={
                isUploading
                  ? `Uploading ${Math.round((progress || 0) * 100)}%`
                  : 'Add portfolio item'
              }
            >
              <Text style={styles.primaryButtonText}>
                {isUploading ? `${Math.round((progress || 0) * 100)}%` : 'Add Item'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {(isPicking || isUploading) && (
        <View style={styles.progressBox}>
          <View style={styles.progressHeader}>
            <Text style={styles.progressLabel}>{uploadMessage || 'Uploading…'}</Text>
            <Text style={styles.progressPercent}>{Math.round((progress || 0) * 100)}%</Text>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.round((progress || 0) * 100)}%` }]} />
          </View>
        </View>
      )}

      {loading ? (
        <ActivityIndicator size="small" color={theme.primary} style={styles.loadingIndicator} />
      ) : visibleItems.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyText}>
            {isOwnProfile
              ? 'Showcase your work! Tap "Add Item" to upload images, videos, or files.'
              : "This user hasn't added portfolio items yet."}
          </Text>
        </View>
      ) : (
        <View style={styles.grid}>
          {visibleItems.map((item, index) => (
            <TouchableOpacity
              key={item.id}
              style={[styles.tile, isReordering && styles.tileReordering]}
              activeOpacity={0.8}
              onPress={() => !isReordering && setSelectedItem(item)}
              onLongPress={() => isOwnProfile && !isReordering && handleDelete(item.id)}
              accessibilityRole="button"
              accessibilityLabel={item.title || item.name || 'Portfolio item'}
              accessibilityHint="Tap to view this portfolio item"
            >
              {item.type === 'image' || item.type === 'video' ? (
                <>
                  <OptimizedImage
                    source={{ uri: item.thumbnail || item.url }}
                    width={Math.round(tileWidth)}
                    height={Math.round(tileWidth)}
                    style={{ width: '100%', height: '100%' }}
                    resizeMode="cover"
                    useThumbnail
                    priority="low"
                    alt={item.title || 'Portfolio item'}
                  />
                  {item.type === 'video' && (
                    <View style={styles.playOverlay}>
                      <View style={styles.playBadge}>
                        <MaterialIcons name="play-arrow" size={20} color="white" />
                      </View>
                    </View>
                  )}
                </>
              ) : (
                <View style={styles.fileTile}>
                  <MaterialIcons name="insert-drive-file" size={26} color={theme.primary} />
                  <Text style={styles.fileName} numberOfLines={2}>
                    {item.name || 'File'}
                  </Text>
                </View>
              )}

              {isReordering && isOwnProfile && items.length > 1 && (
                <View style={styles.reorderOverlay}>
                  <View style={styles.reorderRow}>
                    {index > 0 && (
                      <TouchableOpacity
                        style={styles.reorderButton}
                        onPress={() => move(index, -1)}
                        accessibilityRole="button"
                        accessibilityLabel="Move item earlier"
                      >
                        <MaterialIcons name="arrow-back" size={16} color="white" />
                      </TouchableOpacity>
                    )}
                    {index < items.length - 1 && (
                      <TouchableOpacity
                        style={styles.reorderButton}
                        onPress={() => move(index, 1)}
                        accessibilityRole="button"
                        accessibilityLabel="Move item later"
                      >
                        <MaterialIcons name="arrow-forward" size={16} color="white" />
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              )}

              {isOwnProfile && !isReordering && (
                <TouchableOpacity
                  style={styles.deleteBadge}
                  onPress={() => handleDelete(item.id)}
                  accessibilityRole="button"
                  accessibilityLabel="Delete portfolio item"
                >
                  <MaterialIcons name="close" size={14} color="white" />
                </TouchableOpacity>
              )}
            </TouchableOpacity>
          ))}
        </View>
      )}

      <Modal
        visible={!!selectedItem}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedItem(null)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setSelectedItem(null)}>
          <Pressable onPress={() => {}} style={styles.modalCardWrap}>
            <View style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Portfolio Item</Text>
                <TouchableOpacity
                  onPress={() => setSelectedItem(null)}
                  accessibilityRole="button"
                  accessibilityLabel="Close portfolio item"
                >
                  <MaterialIcons name="close" size={24} color={theme.textSecondary} />
                </TouchableOpacity>
              </View>
              {selectedItem && (
                <>
                  {selectedItem.type === 'video' ? (
                    hasVideo ? (
                      <VideoView
                        player={videoPlayer}
                        nativeControls
                        contentFit="contain"
                        style={styles.modalMedia}
                      />
                    ) : (
                      <View style={[styles.modalMedia, styles.modalMediaFallback]}>
                        <Text style={styles.emptyText}>Unable to load video preview</Text>
                      </View>
                    )
                  ) : (
                    <OptimizedImage
                      source={{ uri: selectedItem.thumbnail || selectedItem.url }}
                      style={styles.modalMedia}
                      resizeMode="contain"
                      useThumbnail={false}
                      priority="high"
                      alt={selectedItem.title || 'Portfolio item detail'}
                    />
                  )}
                  {selectedItem.title && (
                    <Text style={styles.modalItemTitle}>{selectedItem.title}</Text>
                  )}
                  {selectedItem.description && (
                    <Text style={styles.modalItemDescription}>{selectedItem.description}</Text>
                  )}
                </>
              )}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function makeStyles(theme: AppTheme, tileWidth: number) {
  return StyleSheet.create({
    wrap: {
      gap: 10,
    },
    actionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    countText: {
      fontSize: 12,
      color: theme.textSecondary,
    },
    actionButtons: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    secondaryButton: {
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 4,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surfaceSecondary,
    },
    secondaryButtonActive: {
      borderColor: theme.primary,
    },
    secondaryButtonText: {
      fontSize: 12,
      color: theme.textSecondary,
    },
    secondaryButtonTextActive: {
      color: theme.primary,
    },
    primaryButton: {
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 4,
      backgroundColor: theme.primary,
    },
    primaryButtonDisabled: {
      opacity: 0.5,
    },
    primaryButtonText: {
      fontSize: 12,
      fontWeight: '600',
      color: '#ffffff',
    },
    progressBox: {
      padding: 12,
      borderRadius: 10,
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
      gap: 8,
    },
    progressHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    progressLabel: {
      fontSize: 13,
      color: theme.textSecondary,
    },
    progressPercent: {
      fontSize: 13,
      fontWeight: '600',
      color: theme.primary,
    },
    progressTrack: {
      height: 8,
      borderRadius: 999,
      overflow: 'hidden',
      backgroundColor: theme.surfaceSecondary,
    },
    progressFill: {
      height: '100%',
      borderRadius: 999,
      backgroundColor: theme.primary,
    },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'flex-start',
      gap: 8,
    },
    tile: {
      width: tileWidth,
      height: tileWidth,
      borderRadius: 10,
      overflow: 'hidden',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.surfaceSecondary,
      borderWidth: theme.isDark ? 0 : 1,
      borderColor: theme.border,
    },
    tileReordering: {
      borderWidth: 2,
      borderStyle: 'dashed',
      borderColor: theme.primary,
    },
    playOverlay: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
    },
    playBadge: {
      padding: 6,
      borderRadius: 999,
      backgroundColor: 'rgba(0,0,0,0.4)',
    },
    fileTile: {
      alignItems: 'center',
      justifyContent: 'center',
      padding: 8,
      gap: 4,
    },
    fileName: {
      fontSize: 10,
      textAlign: 'center',
      color: theme.textSecondary,
    },
    reorderOverlay: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.isDark ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.65)',
    },
    reorderRow: {
      flexDirection: 'row',
      gap: 8,
    },
    reorderButton: {
      padding: 8,
      borderRadius: 999,
      backgroundColor: theme.primary,
    },
    deleteBadge: {
      position: 'absolute',
      top: 4,
      right: 4,
      padding: 3,
      borderRadius: 999,
      backgroundColor: '#ef4444',
    },
    loadingIndicator: {
      marginVertical: 16,
    },
    emptyBox: {
      padding: 16,
      borderRadius: 12,
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
    },
    emptyText: {
      fontSize: 13,
      color: theme.textSecondary,
      textAlign: 'center',
    },
    modalBackdrop: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(0,0,0,0.6)',
    },
    modalCardWrap: {
      width: '100%',
      maxWidth: 720,
    },
    modalCard: {
      margin: 16,
      padding: 16,
      borderRadius: 12,
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.surfaceSecondary,
    },
    modalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 12,
    },
    modalTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: theme.text,
    },
    modalMedia: {
      width: '100%',
      height: 256,
      borderRadius: 8,
      marginBottom: 12,
    },
    modalMediaFallback: {
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.surfaceSecondary,
    },
    modalItemTitle: {
      fontSize: 16,
      fontWeight: '500',
      marginBottom: 8,
      color: theme.text,
    },
    modalItemDescription: {
      fontSize: 13,
      color: theme.textSecondary,
    },
  });
}
