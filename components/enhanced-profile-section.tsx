'use client';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { VideoView, useVideoPlayer } from 'expo-video';
import { usePortfolioUpload } from 'hooks/use-portfolio-upload';
import { useAuthProfile } from 'hooks/useAuthProfile';
import { useFollow } from 'hooks/useFollow';
import { useNormalizedProfile } from 'hooks/useNormalizedProfile';
import { usePortfolio } from 'hooks/usePortfolio';
import { useRatings } from 'hooks/useRatings';
import { OptimizedImage } from 'lib/components/OptimizedImage';
import { blockingService } from 'lib/services/blocking-service';
import { MAX_PORTFOLIO_ITEMS, portfolioService } from 'lib/services/portfolio-service';
import type { PortfolioItem } from 'lib/types';
import { normalizeAuthProfile, type NormalizedProfile } from 'lib/utils/normalize-profile';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { showReportAlert } from './ReportModal';
import { ReputationScoreCompact } from './ui/reputation-score';
import { EnhancedProfileSectionSkeleton, PortfolioSkeleton } from './ui/skeleton-loaders';
import { VerificationBadge, type VerificationLevel } from './ui/verification-badge';

/**
 * Progress bar component for upload progress
 */
function UploadProgressBar({ progress, message }: { progress: number; message?: string | null }) {
  const [showBar, setShowBar] = useState(false);
  useEffect(() => {
    if (progress > 0 && progress < 1) {
      setShowBar(true);
    } else if (progress >= 1) {
      setShowBar(true);
      const timeout = setTimeout(() => setShowBar(false), 800);
      return () => clearTimeout(timeout);
    } else {
      setShowBar(false);
    }
  }, [progress]);
  if (!showBar) return null;
  return (
    <View className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 mb-3">
      <View className="flex-row items-center justify-between mb-2">
        <Text className="text-sm text-gray-700">{message || 'Uploading…'}</Text>
        <Text className="text-sm font-medium" style={{ color: '#059669' }}>{Math.round(progress * 100)}%</Text>
      </View>
      <View className="h-2 bg-gray-200 rounded-full overflow-hidden">
        <View
          className="h-full rounded-full"
          style={{ width: `${Math.round(progress * 100)}%`, backgroundColor: '#059669' }}
        />
      </View>
    </View>
  );
}

interface EnhancedProfileSectionProps {
  userId?: string;
  isOwnProfile?: boolean;
  showPortfolio?: boolean;
  activityStats?: {
    jobsCompleted?: number;
    jobsAccepted?: number;
    bountiesPosted?: number;
    badgesEarned?: number;
  };
  hideActions?: boolean;
}

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

export function EnhancedProfileSection({
  userId,
  isOwnProfile = true,
  showPortfolio = true,
  activityStats,
  hideActions = false,
}: EnhancedProfileSectionProps) {
  const { profile: normalizedFromHookOrLocal, loading: profileLoading } =
    useNormalizedProfile(userId);
  const { profile: authProfileFromHook } = useAuthProfile();
  const router = useRouter();

  const resolvedUserId = (() => {
    if (normalizedFromHookOrLocal?.id) return normalizedFromHookOrLocal.id;
    if (userId) return userId;
    if (profileLoading && authProfileFromHook?.id) return authProfileFromHook.id;
    return authProfileFromHook?.id ?? 'current-user';
  })();

  const handleMessagePress = () => {
    if (!resolvedUserId || resolvedUserId === 'current-user') return;
    router.push({
      pathname: `/tabs/messenger/user/[userId]`,
      params: { userId: String(resolvedUserId) },
    });
  };

  const currentUserId = authProfileFromHook?.id;
  const showMessageButton =
    !isOwnProfile &&
    !!resolvedUserId &&
    resolvedUserId !== 'current-user' &&
    resolvedUserId !== currentUserId;

  const {
    items,
    loading: portfolioLoading,
    deleteItem,
    addItem,
    refresh,
  } = usePortfolio(resolvedUserId);

  const {
    pickAndUpload,
    isPicking,
    isUploading,
    progress,
    message: uploadMessage,
    lastPicked,
  } = usePortfolioUpload({
    userId: resolvedUserId,
    onUploaded: async item => {
      await addItem({ ...item, id: undefined as any, createdAt: undefined as any } as any);
      try {
        await refresh();
      } catch (e) {
        /* ignore */
      }
    },
  });

  const {
    isFollowing,
    followerCount,
    followingCount,
    toggleFollow,
    loading: followLoading,
  } = useFollow(userId || 'current-user');

  const ratingUserId = resolvedUserId === 'current-user' ? undefined : resolvedUserId;
  const { stats: ratingStats, loading: ratingsLoading } = useRatings(ratingUserId);

  const [selectedPortfolioItem, setSelectedPortfolioItem] = useState<PortfolioItem | null>(null);
  const [isReordering, setIsReordering] = useState(false);
  const { player: selectedVideoPlayer, hasVideo: hasSelectedVideo } =
    usePortfolioVideoPlayer(selectedPortfolioItem);

  const [isBlocked, setIsBlocked] = useState(false);
  const [blockLoading, setBlockLoading] = useState(false);
  const [showMoreActions, setShowMoreActions] = useState(false);

  useEffect(() => {
    if (!isOwnProfile && userId) {
      blockingService.isUserBlocked(userId).then(result => {
        setIsBlocked(result.isBlocked);
      });
    }
  }, [userId, isOwnProfile]);

  const handleBlockUser = async () => {
    if (!userId || isOwnProfile) return;
    setBlockLoading(true);
    try {
      if (isBlocked) {
        const result = await blockingService.unblockUser(userId);
        if (result.success) {
          setIsBlocked(false);
          Alert.alert('User Unblocked', 'You have unblocked this user.');
        } else {
          Alert.alert('Error', result.error || 'Failed to unblock user.');
        }
      } else {
        Alert.alert(
          'Block User',
          'Blocked users cannot message you or see your bounties. Are you sure?',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Block',
              style: 'destructive',
              onPress: async () => {
                const result = await blockingService.blockUser(userId);
                if (result.success) {
                  setIsBlocked(true);
                  Alert.alert('User Blocked', 'This user has been blocked.');
                } else {
                  Alert.alert('Error', result.error || 'Failed to block user.');
                }
              },
            },
          ]
        );
      }
    } finally {
      setBlockLoading(false);
      setShowMoreActions(false);
    }
  };

  const handleReportUser = () => {
    if (!userId || isOwnProfile) return;
    setShowMoreActions(false);
    showReportAlert('profile', userId, effectiveProfile?.username);
  };

  if (profileLoading) {
    return (
      <View className="px-4 py-2">
        <EnhancedProfileSectionSkeleton />
      </View>
    );
  }

  const effectiveProfile: NormalizedProfile | null =
    normalizedFromHookOrLocal || normalizeAuthProfile(authProfileFromHook || null) || null;

  if (!effectiveProfile) {
    return (
      <View className="p-4">
        <Text className="text-center text-gray-500">Profile not found</Text>
      </View>
    );
  }

  const renderVerificationBadge = () => {
    const { verificationStatus } = effectiveProfile || {};
    const status = (verificationStatus || 'unverified') as VerificationLevel;
    if (status === 'unverified') return null;
    return (
      <View className="mt-2">
        <VerificationBadge status={status} size="small" showLabel={true} showExplanation={true} />
      </View>
    );
  };

  const renderReputationScore = () => {
    if (ratingsLoading) return null;
    return (
      <View className="flex-row items-center mt-1">
        <ReputationScoreCompact
          averageRating={ratingStats.averageRating}
          ratingCount={ratingStats.ratingCount}
        />
        {ratingStats.ratingCount > 0 && (
          <Text className="text-xs text-gray-500 ml-2">
            ({ratingStats.ratingCount} review{ratingStats.ratingCount !== 1 ? 's' : ''})
          </Text>
        )}
      </View>
    );
  };

  const handleDeletePortfolioItem = async (itemId: string) => {
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

  return (
    <View className="px-4 py-2 bg-[#0B0F14]">
      {/* Enhanced Profile Header + Stats (merged card) */}
      <View className="bg-[#0B0F14] border border-[#1F2937] rounded-xl p-4 mb-4 shadow-sm">
        <View className="flex-row items-start justify-between">
          <View className="flex-row items-center flex-1">
            <View className="relative">
              <View className="h-16 w-16 rounded-full bg-emerald-100 overflow-hidden items-center justify-center border border-[#1F2937]">
                {effectiveProfile.avatar ? (
                  <OptimizedImage
                    source={{ uri: effectiveProfile.avatar }}
                    width={64}
                    height={64}
                    style={{ width: 64, height: 64, borderRadius: 32 }}
                    resizeMode="cover"
                    useThumbnail
                    priority="low"
                    alt="Profile avatar"
                  />
                ) : (
                  <MaterialIcons name="person" size={32} color="#059669" />
                )}
              </View>
              {renderVerificationBadge()}
            </View>
            <View className="ml-4 flex-1">
              <Text className="text-lg font-bold text-white">
                {effectiveProfile.display_name ||
                  effectiveProfile.name ||
                  effectiveProfile.username}
              </Text>
              <Text className="text-xs text-gray-500">
                {effectiveProfile.username ? `@${effectiveProfile.username}` : ''}
              </Text>
              {renderReputationScore()}
              {effectiveProfile.title && (
                <Text className="text-sm text-gray-400 mt-1">{effectiveProfile.title}</Text>
              )}
            </View>
          </View>
          {!isOwnProfile && (
            <TouchableOpacity
              onPress={toggleFollow}
              disabled={followLoading}
              className={`px-4 py-2 rounded-lg ${isFollowing ? 'bg-[#1F2937] border border-[#374151] text-white' : 'bg-emerald-600'}`}
            >
              {followLoading ? (
                <ActivityIndicator size="small" color={isFollowing ? '#059669' : '#ffffff'} />
              ) : (
                <Text className={`text-sm font-medium ${isFollowing ? 'text-emerald-700' : 'text-white'}`}>
                  {isFollowing ? 'Following' : 'Follow'}
                </Text>
              )}
            </TouchableOpacity>
          )}
          {!isOwnProfile && !hideActions && (
            <TouchableOpacity
              onPress={() => setShowMoreActions(true)}
              className="ml-2 p-2 rounded-lg bg-gray-100"
              accessibilityLabel="More actions"
              accessibilityHint="Open menu for report and block options"
            >
              <MaterialIcons name="more-vert" size={20} color="#6B7280" />
            </TouchableOpacity>
          )}
        </View>

        {/* More Actions Modal */}
        {!isOwnProfile && !hideActions && (
          <Modal
            visible={showMoreActions}
            transparent
            animationType="fade"
            onRequestClose={() => setShowMoreActions(false)}
          >
            <Pressable
              style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}
              onPress={() => setShowMoreActions(false)}
              accessibilityLabel="Close menu"
              accessibilityRole="button"
              accessibilityHint="Double tap to dismiss the action menu"
            >
              <View style={{ padding: 16 }}>
                <View style={{ backgroundColor: '#ffffff', borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: '#E5E7EB' }}>
                  <TouchableOpacity
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      paddingVertical: 16,
                      paddingHorizontal: 20,
                      gap: 12,
                    }}
                    onPress={handleReportUser}
                  >
                    <MaterialIcons name="flag" size={22} color="#dc2626" />
                    <Text style={{ fontSize: 16, color: '#dc2626', fontWeight: '500' }}>
                      Report User
                    </Text>
                  </TouchableOpacity>
                  <View
                    style={{
                      height: 1,
                      backgroundColor: '#E5E7EB',
                      marginHorizontal: 20,
                    }}
                  />
                  <TouchableOpacity
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      paddingVertical: 16,
                      paddingHorizontal: 20,
                      gap: 12,
                    }}
                    onPress={handleBlockUser}
                    disabled={blockLoading}
                  >
                    {blockLoading ? (
                      <ActivityIndicator size="small" color="#dc2626" />
                    ) : (
                      <MaterialIcons
                        name={isBlocked ? 'check-circle' : 'block'}
                        size={22}
                        color={isBlocked ? '#059669' : '#dc2626'}
                      />
                    )}
                    <Text
                      style={{
                        fontSize: 16,
                        color: isBlocked ? '#059669' : '#dc2626',
                        fontWeight: '500',
                      }}
                    >
                      {isBlocked ? 'Unblock User' : 'Block User'}
                    </Text>
                  </TouchableOpacity>
                  <View
                    style={{
                      height: 1,
                      backgroundColor: '#E5E7EB',
                      marginHorizontal: 20,
                    }}
                  />
                  <TouchableOpacity
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      paddingVertical: 16,
                      paddingHorizontal: 20,
                      gap: 12,
                    }}
                    onPress={() => setShowMoreActions(false)}
                  >
                    <MaterialIcons name="close" size={22} color="#6B7280" />
                    <Text style={{ fontSize: 16, color: '#6B7280', fontWeight: '500' }}>
                      Cancel
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            </Pressable>
          </Modal>
        )}

        {/* Bio */}
        {effectiveProfile.bio && (
          <Text className="text-sm text-white mt-3">{effectiveProfile.bio}</Text>
        )}

        {/* Location & Portfolio/Website */}
        {(effectiveProfile.location || effectiveProfile.portfolio) && (
          <View className="mt-3 space-y-2">
            {effectiveProfile.location && (
              <View className="flex-row items-center">
                <MaterialIcons name="location-on" size={16} color="#059669" />
                <Text className="text-sm text-gray-400 ml-2">{effectiveProfile.location}</Text>
              </View>
            )}
            {effectiveProfile.portfolio && (
              <View className="flex-row items-center">
                <MaterialIcons name="link" size={16} color="#059669" />
                <Text className="text-sm text-gray-400 ml-2" numberOfLines={1}>
                  {effectiveProfile.portfolio}
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Stats Row */}
        <View className="flex-row justify-around mt-4 pt-3 border-t border-[#1F2937]">
          <View className="items-center">
            <Text className="text-2xl font-bold text-white">
              {activityStats?.jobsCompleted ?? activityStats?.jobsAccepted ?? 0}
            </Text>
            <Text className="text-xs text-gray-500 mt-1">Jobs Completed</Text>
          </View>
          <View className="items-center">
            <Text className="text-2xl font-bold text-white">{activityStats?.bountiesPosted ?? 0}</Text>
            <Text className="text-xs text-gray-500 mt-1">Bounties Posted</Text>
          </View>
          <View className="items-center">
            <Text className="text-2xl font-bold text-white">{followerCount ?? 0}</Text>
            <Text className="text-xs text-gray-500 mt-1">Followers</Text>
          </View>
        </View>

        {/* Joined Date */}
        <View className="mt-3 items-center">
          <Text className="text-xs text-gray-400">
            Joined{' '}
            {new Date(
              (effectiveProfile as any).created_at || effectiveProfile.joinDate || Date.now()
            ).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
          </Text>
        </View>
      </View>

      {/* Message button — only rendered when viewing another user's profile */}
      {showMessageButton && (
        <TouchableOpacity
          onPress={handleMessagePress}
          className="ml-2 py-2 rounded-lg self-stretch mb-2"
          style={{ backgroundColor: '#059669' }}
        >
          <Text className="text-white text-sm font-medium text-center">Message</Text>
        </TouchableOpacity>
      )}

      {/* Portfolio */}
      {showPortfolio && (
        <View className="mb-4">
          <View className="flex-row justify-between items-center mb-2">
            <View className="flex-row items-center">
              <Text className="text-sm font-medium text-gray-900">Portfolio</Text>
              <Text className="text-xs text-gray-500 ml-2">
                ({items.length}/{MAX_PORTFOLIO_ITEMS})
              </Text>
            </View>
            {isOwnProfile && (
              <View className="flex-row items-center gap-2">
                {items.length > 1 && (
                  <TouchableOpacity
                    className={`px-2 py-1 rounded border ${isReordering ? 'bg-emerald-100 border-emerald-400' : 'bg-gray-100 border-gray-300'}`}
                    onPress={() => setIsReordering(!isReordering)}
                  >
                    <Text className={`text-xs ${isReordering ? 'text-emerald-700' : 'text-gray-400'}`}>{isReordering ? 'Done' : 'Reorder'}</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  className={`px-2 py-1 rounded ${items.length >= MAX_PORTFOLIO_ITEMS ? 'opacity-50' : ''}`}
                  style={{ backgroundColor: '#059669' }}
                  onPress={pickAndUpload}
                  disabled={isPicking || isUploading || items.length >= MAX_PORTFOLIO_ITEMS}
                >
                  <Text className="text-xs text-white">
                    {isUploading ? `${Math.round((progress || 0) * 100)}%` : 'Add Item'}
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
          {(isPicking || isUploading) && (
            <UploadProgressBar progress={progress} message={uploadMessage} />
          )}
          {portfolioLoading ? (
            <View className="items-center py-4">
              <ActivityIndicator size="small" color="#059669" />
            </View>
          ) : items.length === 0 && !lastPicked ? (
            <View className="bg-emerald-50 border border-emerald-100 p-4 rounded-lg">
              <Text className="text-center text-gray-400 text-sm">
                {isOwnProfile
                  ? 'Showcase your work! Tap "Add Item" to upload images, videos, or files.'
                  : "This user hasn't added portfolio items yet."}
              </Text>
            </View>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View className="flex-row gap-3">
                {(lastPicked
                  ? [
                      {
                        id: lastPicked.id,
                        userId: resolvedUserId,
                        type:
                          lastPicked.kind === 'video'
                            ? 'video'
                            : lastPicked.kind === 'image'
                              ? 'image'
                              : 'file',
                        url: lastPicked.uri,
                        thumbnail: lastPicked.kind === 'image' ? lastPicked.uri : undefined,
                        name: lastPicked.name,
                        createdAt: new Date().toISOString(),
                      } as PortfolioItem,
                    ].concat(items)
                  : items
                ).map((item, index) => (
                  <TouchableOpacity
                    key={item.id}
                    className="relative"
                    onPress={() => !isReordering && setSelectedPortfolioItem(item)}
                    onLongPress={() =>
                      isOwnProfile && !isReordering && handleDeletePortfolioItem(item.id)
                    }
                  >
                    <View
                      className={`w-32 h-32 bg-emerald-50 rounded-lg overflow-hidden items-center justify-center border border-[#1F2937] ${
                        isReordering ? 'border-2 border-dashed border-emerald-400' : ''
                      }`}
                    >
                      {item.type === 'image' || item.type === 'video' ? (
                        <>
                          <OptimizedImage
                            source={{ uri: item.thumbnail || item.url }}
                            width={128}
                            height={128}
                            style={{ width: '100%', height: '100%' }}
                            resizeMode="cover"
                            useThumbnail={true}
                            priority="low"
                            alt={item.title || 'Portfolio item'}
                          />
                          {item.type === 'video' && (
                            <View className="absolute inset-0 items-center justify-center">
                              <View className="bg-black/40 rounded-full p-2">
                                <MaterialIcons name="play-arrow" size={24} color="white" />
                              </View>
                            </View>
                          )}
                        </>
                      ) : (
                        <View className="items-center justify-center p-3">
                          <MaterialIcons name="insert-drive-file" size={28} color="#059669" />
                          <Text className="text-[10px] text-gray-400 mt-1" numberOfLines={2}>
                            {item.name || 'File'}
                          </Text>
                        </View>
                      )}
                      {isReordering && isOwnProfile && items.length > 1 && (
                        <View className="absolute inset-0 bg-white/60 items-center justify-center">
                          <View className="flex-row gap-2">
                            {index > 0 && (
                              <TouchableOpacity
                                className="rounded-full p-2"
                                style={{ backgroundColor: '#059669' }}
                                onPress={async () => {
                                  const newOrder = [...items];
                                  [newOrder[index - 1], newOrder[index]] = [
                                    newOrder[index],
                                    newOrder[index - 1],
                                  ];
                                  await portfolioService.reorderItems(
                                    resolvedUserId,
                                    newOrder.map(i => i.id)
                                  );
                                  await refresh();
                                }}
                              >
                                <MaterialIcons name="arrow-back" size={16} color="white" />
                              </TouchableOpacity>
                            )}
                            {index < items.length - 1 && (
                              <TouchableOpacity
                                className="rounded-full p-2"
                                style={{ backgroundColor: '#059669' }}
                                onPress={async () => {
                                  const newOrder = [...items];
                                  [newOrder[index], newOrder[index + 1]] = [
                                    newOrder[index + 1],
                                    newOrder[index],
                                  ];
                                  await portfolioService.reorderItems(
                                    resolvedUserId,
                                    newOrder.map(i => i.id)
                                  );
                                  await refresh();
                                }}
                              >
                                <MaterialIcons name="arrow-forward" size={16} color="white" />
                              </TouchableOpacity>
                            )}
                          </View>
                        </View>
                      )}
                    </View>
                    {isOwnProfile && !isReordering && (
                      <TouchableOpacity
                        className="absolute top-1 right-1 bg-red-500 rounded-full p-1"
                        onPress={() => handleDeletePortfolioItem(item.id)}
                      >
                        <MaterialIcons name="close" size={16} color="white" />
                      </TouchableOpacity>
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          )}
        </View>
      )}

      {/* Portfolio Detail Modal */}
      <Modal
        visible={!!selectedPortfolioItem}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedPortfolioItem(null)}
      >
        <Pressable
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(0,0,0,0.6)',
          }}
          onPress={() => setSelectedPortfolioItem(null)}
        >
          <Pressable onPress={() => {}} style={{ width: '100%', maxWidth: 720 }}>
            <View className="bg-[#0B0F14] rounded-xl p-4 m-4 max-w-lg w-full border border-[#1F2937]">
              <View className="flex-row justify-between items-center mb-3">
                <Text className="text-lg font-bold text-gray-900">Portfolio Item</Text>
                <TouchableOpacity onPress={() => setSelectedPortfolioItem(null)}>
                  <MaterialIcons name="close" size={24} color="#6B7280" />
                </TouchableOpacity>
              </View>
              {selectedPortfolioItem && (
                <>
                  {selectedPortfolioItem.type === 'video' ? (
                    hasSelectedVideo ? (
                      <VideoView
                        player={selectedVideoPlayer}
                        nativeControls
                        contentFit="contain"
                        style={{ width: '100%', height: 256, borderRadius: 8, marginBottom: 12 }}
                      />
                    ) : (
                      <View className="bg-gray-100 rounded-lg items-center justify-center h-64 mb-3">
                        <Text className="text-gray-500">Unable to load video preview</Text>
                      </View>
                    )
                  ) : (
                    <OptimizedImage
                      source={{ uri: selectedPortfolioItem.thumbnail || selectedPortfolioItem.url }}
                      style={{ width: '100%', height: 256, borderRadius: 8, marginBottom: 12 }}
                      resizeMode="contain"
                      useThumbnail={false}
                      priority="high"
                      alt={selectedPortfolioItem.title || 'Portfolio item detail'}
                    />
                  )}
                  {selectedPortfolioItem.title && (
                    <Text className="text-base font-medium text-gray-900 mb-2">
                      {selectedPortfolioItem.title}
                    </Text>
                  )}
                  {selectedPortfolioItem.description && (
                    <Text className="text-sm text-gray-400">
                      {selectedPortfolioItem.description}
                    </Text>
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

// Standalone Portfolio section to render after Skillsets
export function PortfolioSection({
  userId,
  isOwnProfile = true,
}: {
  userId?: string;
  isOwnProfile?: boolean;
}) {
  const { profile: normalizedFromHookOrLocal } = useNormalizedProfile(userId);
  const { profile: authProfileFromHook } = useAuthProfile();
  const resolvedUserId =
    normalizedFromHookOrLocal?.id || userId || authProfileFromHook?.id || 'current-user';

  const {
    items,
    loading: portfolioLoading,
    deleteItem,
    addItem,
    refresh,
  } = usePortfolio(resolvedUserId);

  const {
    pickAndUpload,
    isPicking,
    isUploading,
    progress,
    message: uploadMessage,
    lastPicked: lastPickedStandalone,
  } = usePortfolioUpload({
    userId: resolvedUserId,
    onUploaded: async item => {
      await addItem({ ...item, id: undefined as any, createdAt: undefined as any } as any);
      try {
        await refresh();
      } catch (e) {
        /* ignore */
      }
    },
  });

  const [selectedPortfolioItem, setSelectedPortfolioItem] = React.useState<PortfolioItem | null>(
    null
  );
  const [isReordering, setIsReordering] = React.useState(false);
  const { player: standaloneVideoPlayer, hasVideo: standaloneHasVideo } =
    usePortfolioVideoPlayer(selectedPortfolioItem);

  const handleDeletePortfolioItem = async (itemId: string) => {
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

  return (
    <View className="mb-4 px-4 bg-[#0B0F14]">
      <View className="flex-row justify-between items-center mb-2">
        <View className="flex-row items-center">
          <Text className="text-sm font-medium text-white">Portfolio</Text>
          <Text className="text-xs text-gray-500 ml-2">
            ({items.length}/{MAX_PORTFOLIO_ITEMS})
          </Text>
        </View>
        {isOwnProfile && (
          <View className="flex-row items-center gap-2">
            {items.length > 1 && (
              <TouchableOpacity
                className={`px-2 py-1 rounded border ${isReordering ? 'bg-emerald-100 border-emerald-400' : 'bg-gray-100 border-gray-300'}`}
                onPress={() => setIsReordering(!isReordering)}
              >
                <Text className={`text-xs ${isReordering ? 'text-emerald-700' : 'text-gray-400'}`}>{isReordering ? 'Done' : 'Reorder'}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              className={`px-2 py-1 rounded ${items.length >= MAX_PORTFOLIO_ITEMS ? 'opacity-50' : ''}`}
              style={{ backgroundColor: '#059669' }}
              onPress={pickAndUpload}
              disabled={isPicking || isUploading || items.length >= MAX_PORTFOLIO_ITEMS}
            >
              <Text className="text-xs text-white">
                {isUploading ? `${Math.round((progress || 0) * 100)}%` : 'Add Item'}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
      {(isPicking || isUploading) && (
        <UploadProgressBar progress={progress} message={uploadMessage} />
      )}
      {portfolioLoading ? (
        <PortfolioSkeleton count={3} />
      ) : items.length === 0 && !lastPickedStandalone ? (
        <View className="bg-[#111827] border border-[#1F2937] p-4 rounded-lg">
          <Text className="text-center text-gray-400 text-sm">
            {isOwnProfile
              ? 'Showcase your work! Tap "Add Item" to upload images, videos, or files.'
              : "This user hasn't added portfolio items yet."}
          </Text>
        </View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View className="flex-row gap-3">
            {(lastPickedStandalone
              ? [
                  {
                    id: lastPickedStandalone.id,
                    userId: resolvedUserId,
                    type:
                      lastPickedStandalone.kind === 'video'
                        ? 'video'
                        : lastPickedStandalone.kind === 'image'
                          ? 'image'
                          : 'file',
                    url: lastPickedStandalone.uri,
                    thumbnail:
                      lastPickedStandalone.kind === 'image' ? lastPickedStandalone.uri : undefined,
                    name: lastPickedStandalone.name,
                    createdAt: new Date().toISOString(),
                  } as PortfolioItem,
                ].concat(items)
              : items
            ).map((item, index) => (
              <TouchableOpacity
                key={item.id}
                className="relative"
                onPress={() => !isReordering && setSelectedPortfolioItem(item)}
                onLongPress={() =>
                  isOwnProfile && !isReordering && handleDeletePortfolioItem(item.id)
                }
              >
                <View
                  className={`w-32 h-32 bg-emerald-50 rounded-lg overflow-hidden items-center justify-center border border-[#1F2937] ${
                    isReordering ? 'border-2 border-dashed border-emerald-400' : ''
                  }`}
                >
                  {item.type === 'image' || item.type === 'video' ? (
                    <>
                      <OptimizedImage
                        source={{ uri: item.thumbnail || item.url }}
                        width={128}
                        height={128}
                        style={{ width: '100%', height: '100%' }}
                        resizeMode="cover"
                        useThumbnail
                        priority="low"
                        alt={item.title || 'Portfolio item'}
                      />
                      {item.type === 'video' && (
                        <View className="absolute inset-0 items-center justify-center">
                          <View className="bg-black/40 rounded-full p-2">
                            <MaterialIcons name="play-arrow" size={24} color="white" />
                          </View>
                        </View>
                      )}
                    </>
                  ) : (
                    <View className="items-center justify-center p-3">
                      <MaterialIcons name="insert-drive-file" size={28} color="#059669" />
                      <Text className="text-[10px] text-gray-400 mt-1" numberOfLines={2}>
                        {item.name || 'File'}
                      </Text>
                    </View>
                  )}
                  {isReordering && isOwnProfile && items.length > 1 && (
                    <View className="absolute inset-0 bg-white/60 items-center justify-center">
                      <View className="flex-row gap-2">
                        {index > 0 && (
                          <TouchableOpacity
                            className="rounded-full p-2"
                            style={{ backgroundColor: '#059669' }}
                            onPress={async () => {
                              const newOrder = [...items];
                              [newOrder[index - 1], newOrder[index]] = [
                                newOrder[index],
                                newOrder[index - 1],
                              ];
                              await portfolioService.reorderItems(
                                resolvedUserId,
                                newOrder.map(i => i.id)
                              );
                              await refresh();
                            }}
                          >
                            <MaterialIcons name="arrow-back" size={16} color="white" />
                          </TouchableOpacity>
                        )}
                        {index < items.length - 1 && (
                          <TouchableOpacity
                            className="rounded-full p-2"
                            style={{ backgroundColor: '#059669' }}
                            onPress={async () => {
                              const newOrder = [...items];
                              [newOrder[index], newOrder[index + 1]] = [
                                newOrder[index + 1],
                                newOrder[index],
                              ];
                              await portfolioService.reorderItems(
                                resolvedUserId,
                                newOrder.map(i => i.id)
                              );
                              await refresh();
                            }}
                          >
                            <MaterialIcons name="arrow-forward" size={16} color="white" />
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>
                  )}
                </View>
                {isOwnProfile && !isReordering && (
                  <TouchableOpacity
                    className="absolute top-1 right-1 bg-red-500 rounded-full p-1"
                    onPress={() => handleDeletePortfolioItem(item.id)}
                  >
                    <MaterialIcons name="close" size={16} color="white" />
                  </TouchableOpacity>
                )}
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
      )}
      <Modal
        visible={!!selectedPortfolioItem}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedPortfolioItem(null)}
      >
        <Pressable
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(0,0,0,0.6)',
          }}
          onPress={() => setSelectedPortfolioItem(null)}
        >
          <Pressable onPress={() => {}} style={{ width: '100%', maxWidth: 720 }}>
            <View className="bg-[#111827] rounded-xl p-4 m-4 max-w-lg w-full border border-[#1F2937]">
              <View className="flex-row justify-between items-center mb-3">
                <Text className="text-lg font-bold text-white">Portfolio Item</Text>
                <TouchableOpacity onPress={() => setSelectedPortfolioItem(null)}>
                  <MaterialIcons name="close" size={24} color="#6B7280" />
                </TouchableOpacity>
              </View>
              {selectedPortfolioItem && (
                <>
                  {selectedPortfolioItem.type === 'video' ? (
                    standaloneHasVideo ? (
                      <VideoView
                        player={standaloneVideoPlayer}
                        nativeControls
                        contentFit="contain"
                        style={{ width: '100%', height: 256, borderRadius: 8, marginBottom: 12 }}
                      />
                    ) : (
                      <View className="bg-gray-100 rounded-lg items-center justify-center h-64 mb-3">
                        <Text className="text-gray-500">Unable to load video preview</Text>
                      </View>
                    )
                  ) : (
                    <OptimizedImage
                      source={{ uri: selectedPortfolioItem.thumbnail || selectedPortfolioItem.url }}
                      style={{ width: '100%', height: 256, borderRadius: 8, marginBottom: 12 }}
                      resizeMode="contain"
                      useThumbnail={false}
                      priority="high"
                      alt={selectedPortfolioItem.title || 'Portfolio item detail'}
                    />
                  )}
                  {selectedPortfolioItem.title && (
                    <Text className="text-base font-medium text-gray-900 mb-2">
                      {selectedPortfolioItem.title}
                    </Text>
                  )}
                  {selectedPortfolioItem.description && (
                    <Text className="text-sm text-gray-400">
                      {selectedPortfolioItem.description}
                    </Text>
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