"use client"

import { MaterialIcons } from "@expo/vector-icons";
import { VideoView, useVideoPlayer } from 'expo-video';
import { usePortfolioUpload } from "hooks/use-portfolio-upload";
import { useAuthProfile } from "hooks/useAuthProfile";
import { useFollow } from "hooks/useFollow";
import { useNormalizedProfile } from "hooks/useNormalizedProfile";
import { usePortfolio } from "hooks/usePortfolio";
import { useRatings } from "hooks/useRatings";
import { OptimizedImage } from "lib/components/OptimizedImage";
import { blockingService } from "lib/services/blocking-service";
import { MAX_PORTFOLIO_ITEMS, portfolioService } from "lib/services/portfolio-service";
import type { PortfolioItem } from "lib/types";
import { normalizeAuthProfile, type NormalizedProfile } from "lib/utils/normalize-profile";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { showReportAlert } from "./ReportModal";
import { ReputationScoreCompact } from "./ui/reputation-score";
import { EnhancedProfileSectionSkeleton, PortfolioSkeleton } from "./ui/skeleton-loaders";
import { VerificationBadge, type VerificationLevel } from "./ui/verification-badge";

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
    // ↓ CHANGED: bg-emerald-900/50 → bg-emerald-50 border border-emerald-200
    <View className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 mb-3">
      <View className="flex-row items-center justify-between mb-2">
        {/* ↓ CHANGED: text-white → text-[#1a1a1a] */}
        <Text className="text-sm text-[#1a1a1a]">{message || 'Uploading…'}</Text>
        {/* ↓ CHANGED: text-emerald-300 → text-emerald-700 */}
        <Text className="text-sm text-emerald-700">{Math.round(progress * 100)}%</Text>
      </View>
      {/* ↓ CHANGED: bg-emerald-800 → bg-emerald-100 */}
      <View className="h-2 bg-emerald-100 rounded-full overflow-hidden">
        {/* bg-emerald-400 kept — good contrast on light track */}
        <View
          className="h-full bg-emerald-400 rounded-full"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </View>
    </View>
  );
}

interface EnhancedProfileSectionProps {
  userId?: string;
  isOwnProfile?: boolean;
  showPortfolio?: boolean;
  activityStats?: { jobsAccepted: number; bountiesPosted: number; badgesEarned: number };
  hideActions?: boolean;
}

function usePortfolioVideoPlayer(item: PortfolioItem | null) {
  const source = useMemo(() => {
    if (item?.type === 'video' && item.url) {
      return { uri: item.url };
    }
    return null;
  }, [item]);

  const player = useVideoPlayer(source, (playerInstance) => {
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
  const { profile: normalizedFromHookOrLocal, loading: profileLoading } = useNormalizedProfile(userId);
  const resolvedUserId = userId || 'current-user';
  const { items, loading: portfolioLoading, deleteItem, addItem, refresh } = usePortfolio(resolvedUserId);
  const { pickAndUpload, isPicking, isUploading, progress, message: uploadMessage, lastPicked } = usePortfolioUpload({
    userId: resolvedUserId,
    onUploaded: async (item) => {
      await addItem({ ...item, id: undefined as any, createdAt: undefined as any } as any);
      try { await refresh(); } catch (e) { /* ignore */ }
    },
  });
  const { isFollowing, followerCount, followingCount, toggleFollow, loading: followLoading } = useFollow(userId || 'current-user');
  const ratingUserId = resolvedUserId === 'current-user' ? undefined : resolvedUserId;
  const { stats: ratingStats, loading: ratingsLoading } = useRatings(ratingUserId);
  const [selectedPortfolioItem, setSelectedPortfolioItem] = useState<PortfolioItem | null>(null);
  const [isReordering, setIsReordering] = useState(false);
  const { player: selectedVideoPlayer, hasVideo: hasSelectedVideo } = usePortfolioVideoPlayer(selectedPortfolioItem);
  const { profile: authProfileFromHook } = useAuthProfile();
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
        Alert.alert('Block User', 'Blocked users cannot message you or see your bounties. Are you sure?', [
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
        ]);
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

  const effectiveProfile: NormalizedProfile | null = normalizedFromHookOrLocal || normalizeAuthProfile(authProfileFromHook || null) || null;

  if (!effectiveProfile) {
    return (
      <View className="p-4">
        {/* ↓ CHANGED: text-emerald-200 → text-emerald-700 */}
        <Text className="text-center text-emerald-700">Profile not found</Text>
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
        <ReputationScoreCompact averageRating={ratingStats.averageRating} ratingCount={ratingStats.ratingCount} />
        {ratingStats.ratingCount > 0 && (
          // ↓ CHANGED: text-emerald-300 → text-emerald-700
          <Text className="text-xs text-emerald-700 ml-2">
            ({ratingStats.ratingCount} review{ratingStats.ratingCount !== 1 ? 's' : ''})
          </Text>
        )}
      </View>
    );
  };

  const handleDeletePortfolioItem = async (itemId: string) => {
    Alert.alert('Delete item', 'Are you sure you want to delete this portfolio item?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await deleteItem(itemId); } },
    ]);
  };

  return (
    <View className="px-4 py-2">
      {/* Enhanced Profile Header + Stats (merged card) */}
      {/* ↓ CHANGED: bg-black/30 backdrop-blur-sm → bg-white border border-[#e5e7eb] */}
      <View className="bg-white border border-[#e5e7eb] rounded-xl p-4 mb-4">
        <View className="flex-row items-start justify-between">
          <View className="flex-row items-center flex-1">
            <View className="relative">
              {/* ↓ CHANGED: bg-emerald-700 → bg-emerald-50 */}
              <View className="h-16 w-16 rounded-full bg-emerald-50 overflow-hidden items-center justify-center">
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
                  // ↓ CHANGED: icon color #d1fae5 → #059669
                  <MaterialIcons name="person" size={32} color="#059669" />
                )}
              </View>
              {renderVerificationBadge()}
            </View>
            <View className="ml-4 flex-1">
              {/* ↓ CHANGED: implicit text-white → text-[#1a1a1a] */}
              <Text className="text-lg font-bold text-[#1a1a1a]">{effectiveProfile.name || effectiveProfile.username}</Text>
              {/* ↓ CHANGED: text-emerald-300 → text-emerald-600 */}
              <Text className="text-xs text-emerald-600">{effectiveProfile.username}</Text>
              {renderReputationScore()}
              {effectiveProfile.title && (
                // ↓ CHANGED: text-emerald-200 → text-[#4b5563]
                <Text className="text-sm text-[#4b5563] mt-1">{effectiveProfile.title}</Text>
              )}
            </View>
          </View>

          {!isOwnProfile && (
            <TouchableOpacity
              onPress={toggleFollow}
              disabled={followLoading}
              // ↓ CHANGED: following → bg-[#F8F9FA] border border-emerald-500 | not following → bg-emerald-500 (kept)
              className={`px-4 py-2 rounded-lg ${isFollowing ? 'bg-[#F8F9FA] border border-emerald-500' : 'bg-emerald-500'}`}
            >
              {followLoading ? (
                <ActivityIndicator size="small" color="#059669" />
              ) : (
                // ↓ CHANGED: following text → text-emerald-700 | not following → text-white (kept)
                <Text className={`text-sm font-medium ${isFollowing ? 'text-emerald-700' : 'text-white'}`}>
                  {isFollowing ? 'Following' : 'Follow'}
                </Text>
              )}
            </TouchableOpacity>
          )}

          {!isOwnProfile && !hideActions && (
            // ↓ CHANGED: bg-emerald-700/50 → bg-[#F8F9FA] border border-[#e5e7eb]
            <TouchableOpacity
              onPress={() => setShowMoreActions(true)}
              className="ml-2 p-2 rounded-lg bg-[#F8F9FA] border border-[#e5e7eb]"
              accessibilityLabel="More actions"
              accessibilityHint="Open menu for report and block options"
            >
              {/* ↓ CHANGED: icon color #d1fae5 → #059669 */}
              <MaterialIcons name="more-vert" size={20} color="#059669" />
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
              style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}
              onPress={() => setShowMoreActions(false)}
              accessibilityLabel="Close menu"
              accessibilityRole="button"
              accessibilityHint="Double tap to dismiss the action menu"
            >
              <View style={{ padding: 16 }}>
                {/* ↓ CHANGED: backgroundColor #065f46 → #ffffff */}
                <View style={{ backgroundColor: '#ffffff', borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: '#e5e7eb' }}>
                  <TouchableOpacity
                    style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 16, paddingHorizontal: 20, gap: 12 }}
                    onPress={handleReportUser}
                  >
                    {/* report/block icon colors kept as-is — red/green on white is fine */}
                    <MaterialIcons name="flag" size={22} color="#fca5a5" />
                    <Text style={{ fontSize: 16, color: '#ef4444', fontWeight: '500' }}>Report User</Text>
                  </TouchableOpacity>

                  {/* ↓ CHANGED: divider rgba(16,185,129,0.2) → #f0f0f0 */}
                  <View style={{ height: 1, backgroundColor: '#f0f0f0', marginHorizontal: 20 }} />

                  <TouchableOpacity
                    style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 16, paddingHorizontal: 20, gap: 12 }}
                    onPress={handleBlockUser}
                    disabled={blockLoading}
                  >
                    {blockLoading ? (
                      <ActivityIndicator size="small" color="#059669" />
                    ) : (
                      <MaterialIcons name={isBlocked ? 'check-circle' : 'block'} size={22} color={isBlocked ? '#059669' : '#fca5a5'} />
                    )}
                    <Text style={{ fontSize: 16, color: isBlocked ? '#059669' : '#ef4444', fontWeight: '500' }}>
                      {isBlocked ? 'Unblock User' : 'Block User'}
                    </Text>
                  </TouchableOpacity>

                  <View style={{ height: 1, backgroundColor: '#f0f0f0', marginHorizontal: 20 }} />

                  <TouchableOpacity
                    style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 16, paddingHorizontal: 20, gap: 12 }}
                    onPress={() => setShowMoreActions(false)}
                  >
                    {/* ↓ CHANGED: icon color #d1fae5 → #6b7280 */}
                    <MaterialIcons name="close" size={22} color="#6b7280" />
                    {/* ↓ CHANGED: text color #d1fae5 → #1a1a1a */}
                    <Text style={{ fontSize: 16, color: '#1a1a1a', fontWeight: '500' }}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </Pressable>
          </Modal>
        )}

        {/* Bio */}
        {effectiveProfile.bio && (
          // ↓ CHANGED: text-emerald-200 → text-[#4b5563]
          <Text className="text-sm text-[#4b5563] mt-3">{effectiveProfile.bio}</Text>
        )}

        {/* Location & Portfolio/Website */}
        {(effectiveProfile.location || effectiveProfile.portfolio) && (
          <View className="mt-3 space-y-2">
            {effectiveProfile.location && (
              <View className="flex-row items-center">
                {/* ↓ CHANGED: icon color #6ee7b7 → #059669 */}
                <MaterialIcons name="location-on" size={16} color="#059669" />
                {/* ↓ CHANGED: text-emerald-200 → text-[#4b5563] */}
                <Text className="text-sm text-[#4b5563] ml-2">{effectiveProfile.location}</Text>
              </View>
            )}
            {effectiveProfile.portfolio && (
              <View className="flex-row items-center">
                {/* ↓ CHANGED: icon color #6ee7b7 → #059669 */}
                <MaterialIcons name="link" size={16} color="#059669" />
                <Text className="text-sm text-[#4b5563] ml-2" numberOfLines={1}>
                  {effectiveProfile.portfolio}
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Stats Row */}
        {/* ↓ CHANGED: border-emerald-500/30 → border-[#e5e7eb] */}
        <View className="flex-row justify-around mt-4 pt-3 border-t border-[#e5e7eb]">
          <View className="items-center">
            {/* ↓ CHANGED: implicit text-white → text-[#1a1a1a] */}
            <Text className="text-2xl font-bold text-[#1a1a1a]">{activityStats?.jobsAccepted ?? 0}</Text>
            {/* ↓ CHANGED: text-emerald-200 → text-[#6b7280] */}
            <Text className="text-xs text-[#6b7280] mt-1">Jobs Accepted</Text>
          </View>
          <View className="items-center">
            <Text className="text-2xl font-bold text-[#1a1a1a]">{activityStats?.bountiesPosted ?? 0}</Text>
            <Text className="text-xs text-[#6b7280] mt-1">Bounties Posted</Text>
          </View>
          <View className="items-center">
            <Text className="text-2xl font-bold text-[#1a1a1a]">{activityStats?.badgesEarned ?? 0}</Text>
            <Text className="text-xs text-[#6b7280] mt-1">Badges Earned</Text>
          </View>
        </View>

        {/* Joined Date */}
        <View className="mt-3 items-center">
          {/* ↓ CHANGED: text-emerald-300 → text-[#6b7280] */}
          <Text className="text-xs text-[#6b7280]">
            Joined {new Date((effectiveProfile as any).created_at || effectiveProfile.joinDate || Date.now()).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
          </Text>
        </View>
      </View>

      {showPortfolio && (
        <View className="mb-4">
          <View className="flex-row justify-between items-center mb-2">
            <View className="flex-row items-center">
              {/* ↓ CHANGED: text-white → text-[#1a1a1a] */}
              <Text className="text-sm font-medium text-[#1a1a1a]">Portfolio</Text>
              {/* ↓ CHANGED: text-emerald-300 → text-emerald-600 */}
              <Text className="text-xs text-emerald-600 ml-2">({items.length}/{MAX_PORTFOLIO_ITEMS})</Text>
            </View>
            {isOwnProfile && (
              <View className="flex-row items-center gap-2">
                {items.length > 1 && (
                  // ↓ CHANGED: active bg-emerald-600 | inactive bg-emerald-700 → both bg-[#F8F9FA] border, active gets emerald border
                  <TouchableOpacity
                    className={`px-2 py-1 rounded border ${isReordering ? 'bg-emerald-50 border-emerald-500' : 'bg-[#F8F9FA] border-[#e5e7eb]'}`}
                    onPress={() => setIsReordering(!isReordering)}
                  >
                    {/* ↓ CHANGED: text-white → text-emerald-700 / text-[#6b7280] */}
                    <Text className={`text-xs ${isReordering ? 'text-emerald-700' : 'text-[#6b7280]'}`}>
                      {isReordering ? 'Done' : 'Reorder'}
                    </Text>
                  </TouchableOpacity>
                )}
                {/* Add Item — bg-emerald-500 kept as primary CTA */}
                <TouchableOpacity
                  className={`px-2 py-1 bg-emerald-500 rounded ${items.length >= MAX_PORTFOLIO_ITEMS ? 'opacity-50' : ''}`}
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

          {(isPicking || isUploading) && <UploadProgressBar progress={progress} message={uploadMessage} />}

          {portfolioLoading ? (
            <View className="items-center py-4">
              {/* ↓ CHANGED: ActivityIndicator color #ffffff → #059669 */}
              <ActivityIndicator size="small" color="#059669" />
            </View>
          ) : items.length === 0 && !lastPicked ? (
            // ↓ CHANGED: bg-emerald-700/20 → bg-[#F8F9FA] border border-[#e5e7eb]
            <View className="bg-[#F8F9FA] border border-[#e5e7eb] p-4 rounded-lg">
              {/* ↓ CHANGED: text-white → text-[#6b7280] */}
              <Text className="text-center text-[#6b7280] text-sm">
                {isOwnProfile
                  ? 'Showcase your work! Tap "Add Item" to upload images, videos, or files.'
                  : "This user hasn't added portfolio items yet."}
              </Text>
            </View>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View className="flex-row gap-3">
                {(lastPicked ? [{
                  id: lastPicked.id,
                  userId: resolvedUserId,
                  type: lastPicked.kind === 'video' ? 'video' : lastPicked.kind === 'image' ? 'image' : 'file',
                  url: lastPicked.uri,
                  thumbnail: lastPicked.kind === 'image' ? lastPicked.uri : undefined,
                  name: lastPicked.name,
                  createdAt: new Date().toISOString(),
                } as PortfolioItem].concat(items) : items).map((item, index) => (
                  <TouchableOpacity
                    key={item.id}
                    className="relative"
                    onPress={() => !isReordering && setSelectedPortfolioItem(item)}
                    onLongPress={() => isOwnProfile && !isReordering && handleDeletePortfolioItem(item.id)}
                  >
                    {/* ↓ CHANGED: bg-emerald-700 → bg-[#F8F9FA]; reorder border kept emerald-400 */}
                    <View className={`w-32 h-32 bg-[#F8F9FA] rounded-lg overflow-hidden items-center justify-center ${isReordering ? 'border-2 border-dashed border-emerald-400' : 'border border-[#e5e7eb]'}`}>
                      {item.type === 'image' || item.type === 'video' ? (
                        <>
                          <OptimizedImage
                            source={{ uri: item.thumbnail || item.url }}
                            width={128} height={128}
                            style={{ width: '100%', height: '100%' }}
                            resizeMode="cover"
                            useThumbnail={true}
                            priority="low"
                            alt={item.title || 'Portfolio item'}
                          />
                          {item.type === 'video' && (
                            <View className="absolute inset-0 items-center justify-center">
                              <View className="bg-black/50 rounded-full p-2">
                                <MaterialIcons name="play-arrow" size={24} color="white" />
                              </View>
                            </View>
                          )}
                        </>
                      ) : (
                        <View className="items-center justify-center p-3">
                          {/* ↓ CHANGED: file icon color #ffffff → #059669 */}
                          <MaterialIcons name="insert-drive-file" size={28} color="#059669" />
                          {/* ↓ CHANGED: text-white → text-[#6b7280] */}
                          <Text className="text-[10px] text-[#6b7280] mt-1" numberOfLines={2}>
                            {item.name || 'File'}
                          </Text>
                        </View>
                      )}
                      {isReordering && isOwnProfile && items.length > 1 && (
                        <View className="absolute inset-0 bg-black/30 items-center justify-center">
                          <View className="flex-row gap-2">
                            {index > 0 && (
                              <TouchableOpacity
                                className="bg-emerald-500 rounded-full p-2"
                                onPress={async () => {
                                  const newOrder = [...items];
                                  [newOrder[index - 1], newOrder[index]] = [newOrder[index], newOrder[index - 1]];
                                  await portfolioService.reorderItems(resolvedUserId, newOrder.map(i => i.id));
                                  await refresh();
                                }}
                              >
                                <MaterialIcons name="arrow-back" size={16} color="white" />
                              </TouchableOpacity>
                            )}
                            {index < items.length - 1 && (
                              <TouchableOpacity
                                className="bg-emerald-500 rounded-full p-2"
                                onPress={async () => {
                                  const newOrder = [...items];
                                  [newOrder[index], newOrder[index + 1]] = [newOrder[index + 1], newOrder[index]];
                                  await portfolioService.reorderItems(resolvedUserId, newOrder.map(i => i.id));
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
                      // red delete badge — kept, works on light bg
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
      <Modal visible={!!selectedPortfolioItem} transparent animationType="fade" onRequestClose={() => setSelectedPortfolioItem(null)}>
        <Pressable
          style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.8)' }}
          onPress={() => setSelectedPortfolioItem(null)}
        >
          <Pressable onPress={() => {}} style={{ width: '100%', maxWidth: 720 }}>
            {/* ↓ CHANGED: bg-emerald-800 → bg-white */}
            <View className="bg-white rounded-xl p-4 m-4 max-w-lg w-full">
              <View className="flex-row justify-between items-center mb-3">
                {/* ↓ CHANGED: text-white → text-[#1a1a1a] */}
                <Text className="text-lg font-bold text-[#1a1a1a]">Portfolio Item</Text>
                <TouchableOpacity onPress={() => setSelectedPortfolioItem(null)}>
                  {/* ↓ CHANGED: close icon color white → #6b7280 */}
                  <MaterialIcons name="close" size={24} color="#6b7280" />
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
                      // ↓ CHANGED: bg-black/50 → bg-[#F8F9FA]
                      <View className="bg-[#F8F9FA] rounded-lg items-center justify-center h-64 mb-3">
                        {/* ↓ CHANGED: text-white → text-[#6b7280] */}
                        <Text className="text-[#6b7280]">Unable to load video preview</Text>
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
                    // ↓ CHANGED: text-white → text-[#1a1a1a]
                    <Text className="text-base font-medium text-[#1a1a1a] mb-2">{selectedPortfolioItem.title}</Text>
                  )}
                  {selectedPortfolioItem.description && (
                    // ↓ CHANGED: text-emerald-200 → text-[#4b5563]
                    <Text className="text-sm text-[#4b5563]">{selectedPortfolioItem.description}</Text>
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

// Standalone Portfolio section
export function PortfolioSection({ userId, isOwnProfile = true }: { userId?: string; isOwnProfile?: boolean }) {
  const resolvedUserId = userId || 'current-user';
  const { items, loading: portfolioLoading, deleteItem, addItem, refresh } = usePortfolio(resolvedUserId);
  const { pickAndUpload, isPicking, isUploading, progress, message: uploadMessage, lastPicked: lastPickedStandalone } = usePortfolioUpload({
    userId: resolvedUserId,
    onUploaded: async (item) => {
      await addItem({ ...item, id: undefined as any, createdAt: undefined as any } as any);
      try { await refresh(); } catch (e) { /* ignore */ }
    },
  });
  const [selectedPortfolioItem, setSelectedPortfolioItem] = React.useState<PortfolioItem | null>(null);
  const [isReordering, setIsReordering] = React.useState(false);
  const { player: standaloneVideoPlayer, hasVideo: standaloneHasVideo } = usePortfolioVideoPlayer(selectedPortfolioItem);

  const handleDeletePortfolioItem = async (itemId: string) => {
    Alert.alert('Delete item', 'Are you sure you want to delete this portfolio item?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await deleteItem(itemId); } },
    ]);
  };

  return (
    <View className="mb-4 px-4">
      <View className="flex-row justify-between items-center mb-2">
        <View className="flex-row items-center">
          {/* ↓ CHANGED: text-white → text-[#1a1a1a] */}
          <Text className="text-sm font-medium text-[#1a1a1a]">Portfolio</Text>
          {/* ↓ CHANGED: text-emerald-300 → text-emerald-600 */}
          <Text className="text-xs text-emerald-600 ml-2">({items.length}/{MAX_PORTFOLIO_ITEMS})</Text>
        </View>
        {isOwnProfile && (
          <View className="flex-row items-center gap-2">
            {items.length > 1 && (
              <TouchableOpacity
                className={`px-2 py-1 rounded border ${isReordering ? 'bg-emerald-50 border-emerald-500' : 'bg-[#F8F9FA] border-[#e5e7eb]'}`}
                onPress={() => setIsReordering(!isReordering)}
              >
                <Text className={`text-xs ${isReordering ? 'text-emerald-700' : 'text-[#6b7280]'}`}>
                  {isReordering ? 'Done' : 'Reorder'}
                </Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              className={`px-2 py-1 bg-emerald-500 rounded ${items.length >= MAX_PORTFOLIO_ITEMS ? 'opacity-50' : ''}`}
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

      {(isPicking || isUploading) && <UploadProgressBar progress={progress} message={uploadMessage} />}

      {portfolioLoading ? (
        <PortfolioSkeleton count={3} />
      ) : items.length === 0 && !lastPickedStandalone ? (
        <View className="bg-[#F8F9FA] border border-[#e5e7eb] p-4 rounded-lg">
          <Text className="text-center text-[#6b7280] text-sm">
            {isOwnProfile
              ? 'Showcase your work! Tap "Add Item" to upload images, videos, or files.'
              : "This user hasn't added portfolio items yet."}
          </Text>
        </View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View className="flex-row gap-3">
            {(lastPickedStandalone ? [{
              id: lastPickedStandalone.id,
              userId: resolvedUserId,
              type: lastPickedStandalone.kind === 'video' ? 'video' : lastPickedStandalone.kind === 'image' ? 'image' : 'file',
              url: lastPickedStandalone.uri,
              thumbnail: lastPickedStandalone.kind === 'image' ? lastPickedStandalone.uri : undefined,
              name: lastPickedStandalone.name,
              createdAt: new Date().toISOString(),
            } as PortfolioItem].concat(items) : items).map((item, index) => (
              <TouchableOpacity
                key={item.id}
                className="relative"
                onPress={() => !isReordering && setSelectedPortfolioItem(item)}
                onLongPress={() => isOwnProfile && !isReordering && handleDeletePortfolioItem(item.id)}
              >
                <View className={`w-32 h-32 bg-[#F8F9FA] rounded-lg overflow-hidden items-center justify-center ${isReordering ? 'border-2 border-dashed border-emerald-400' : 'border border-[#e5e7eb]'}`}>
                  {item.type === 'image' || item.type === 'video' ? (
                    <>
                      <OptimizedImage
                        source={{ uri: item.thumbnail || item.url }}
                        width={128} height={128}
                        style={{ width: '100%', height: '100%' }}
                        resizeMode="cover"
                        useThumbnail
                        priority="low"
                        alt={item.title || 'Portfolio item'}
                      />
                      {item.type === 'video' && (
                        <View className="absolute inset-0 items-center justify-center">
                          <View className="bg-black/50 rounded-full p-2">
                            <MaterialIcons name="play-arrow" size={24} color="white" />
                          </View>
                        </View>
                      )}
                    </>
                  ) : (
                    <View className="items-center justify-center p-3">
                      <MaterialIcons name="insert-drive-file" size={28} color="#059669" />
                      <Text className="text-[10px] text-[#6b7280] mt-1" numberOfLines={2}>
                        {item.name || 'File'}
                      </Text>
                    </View>
                  )}
                  {isReordering && isOwnProfile && items.length > 1 && (
                    <View className="absolute inset-0 bg-black/30 items-center justify-center">
                      <View className="flex-row gap-2">
                        {index > 0 && (
                          <TouchableOpacity
                            className="bg-emerald-500 rounded-full p-2"
                            onPress={async () => {
                              const newOrder = [...items];
                              [newOrder[index - 1], newOrder[index]] = [newOrder[index], newOrder[index - 1]];
                              await portfolioService.reorderItems(resolvedUserId, newOrder.map(i => i.id));
                              await refresh();
                            }}
                          >
                            <MaterialIcons name="arrow-back" size={16} color="white" />
                          </TouchableOpacity>
                        )}
                        {index < items.length - 1 && (
                          <TouchableOpacity
                            className="bg-emerald-500 rounded-full p-2"
                            onPress={async () => {
                              const newOrder = [...items];
                              [newOrder[index], newOrder[index + 1]] = [newOrder[index + 1], newOrder[index]];
                              await portfolioService.reorderItems(resolvedUserId, newOrder.map(i => i.id));
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

      <Modal visible={!!selectedPortfolioItem} transparent animationType="fade" onRequestClose={() => setSelectedPortfolioItem(null)}>
        <Pressable
          style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.8)' }}
          onPress={() => setSelectedPortfolioItem(null)}
        >
          <Pressable onPress={() => {}} style={{ width: '100%', maxWidth: 720 }}>
            {/* ↓ CHANGED: bg-emerald-800 → bg-white */}
            <View className="bg-white rounded-xl p-4 m-4 max-w-lg w-full">
              <View className="flex-row justify-between items-center mb-3">
                <Text className="text-lg font-bold text-[#1a1a1a]">Portfolio Item</Text>
                <TouchableOpacity onPress={() => setSelectedPortfolioItem(null)}>
                  <MaterialIcons name="close" size={24} color="#6b7280" />
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
                      <View className="bg-[#F8F9FA] rounded-lg items-center justify-center h-64 mb-3">
                        <Text className="text-[#6b7280]">Unable to load video preview</Text>
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
                    <Text className="text-base font-medium text-[#1a1a1a] mb-2">{selectedPortfolioItem.title}</Text>
                  )}
                  {selectedPortfolioItem.description && (
                    <Text className="text-sm text-[#4b5563]">{selectedPortfolioItem.description}</Text>
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