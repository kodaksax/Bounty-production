import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Skeleton } from './skeleton';
import { useAppThemeContext } from 'lib/themes';

/**
 * Theme-aware container colors for skeleton screens. The static `styles`
 * object below only holds layout (padding/radius/gap) — colors come from
 * here so skeletons don't render as opaque dark panels in light mode.
 */
function useSkeletonColors() {
  const { theme } = useAppThemeContext();
  return React.useMemo(
    () => ({
      surface: { backgroundColor: theme.surface },
      surfaceAlt: { backgroundColor: theme.surfaceSecondary },
      surfaceBorder: { borderColor: theme.border },
      surfaceBorderTop: { borderTopColor: theme.border },
      screen: { backgroundColor: theme.background },
    }),
    [theme]
  );
}

/**
 * Skeleton loader for posting cards
 */
export function PostingCardSkeleton() {
  const c = useSkeletonColors();
  return (
    <View style={[styles.postingCard, c.surface]}>
      {/* Header: avatar and name */}
      <View style={styles.postingHeader}>
        <Skeleton className="h-10 w-10 rounded-full " />
        <View style={styles.postingHeaderText}>
          <Skeleton className="h-4 w-24 mb-2 " />
          <Skeleton className="h-3 w-16 " />
        </View>
      </View>
      
      {/* Title */}
      <Skeleton className="h-5 w-full mb-2 " />
      
      {/* Description lines */}
      <Skeleton className="h-3 w-full mb-2 " />
      <Skeleton className="h-3 w-4/5 mb-3 " />
      
      {/* Amount and location */}
      <View style={styles.postingFooter}>
        <Skeleton className="h-4 w-20 " />
        <Skeleton className="h-4 w-24 " />
      </View>
    </View>
  );
}

/**
 * Skeleton loader for conversation items
 */
export function ConversationItemSkeleton() {
  const c = useSkeletonColors();
  return (
    <View style={[styles.conversationItem, c.surface]}>
      <Skeleton className="h-12 w-12 rounded-full " />
      <View style={styles.conversationContent}>
        <View style={styles.conversationHeader}>
          <Skeleton className="h-4 w-32 " />
          <Skeleton className="h-3 w-12 " />
        </View>
        <Skeleton className="h-3 w-48 mt-2 " />
      </View>
    </View>
  );
}

/**
 * Skeleton loader for individual chat messages
 */
export function ChatMessageSkeleton({ isUser = false }: { isUser?: boolean }) {
  const c = useSkeletonColors();
  return (
    <View style={[styles.chatMessage, isUser ? c.surfaceAlt : c.surface]}>
      <Skeleton className="h-3 w-48 mb-1 " />
      <Skeleton className="h-3 w-32 " />
    </View>
  );
}

/**
 * Multiple chat message skeletons for loading state
 */
export function ChatMessagesListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <ChatMessageSkeleton key={`chat-skeleton-${i}`} isUser={i % 2 === 0} />
      ))}
    </>
  );
}

/**
 * Skeleton loader for wallet transaction items
 */
export function TransactionItemSkeleton() {
  const c = useSkeletonColors();
  return (
    <View style={[styles.transactionItem, c.surface]}>
      <View style={styles.transactionIcon}>
        <Skeleton className="h-10 w-10 rounded-lg " />
      </View>
      <View style={styles.transactionContent}>
        <Skeleton className="h-4 w-40 mb-2 " />
        <Skeleton className="h-3 w-24 " />
      </View>
      <Skeleton className="h-5 w-16 " />
    </View>
  );
}

/**
 * Skeleton loader for profile section
 */
export function ProfileSkeleton() {
  return (
    <View style={styles.profile}>
      {/* Avatar */}
      <View style={styles.profileAvatar}>
        <Skeleton className="h-20 w-20 rounded-full " />
      </View>
      
      {/* Name and bio */}
      <Skeleton className="h-6 w-40 mb-2 " />
      <Skeleton className="h-4 w-56 mb-3 " />
      
      {/* Stats */}
      <View style={styles.profileStats}>
        <View style={styles.profileStat}>
          <Skeleton className="h-6 w-12 mb-1 " />
          <Skeleton className="h-3 w-16 " />
        </View>
        <View style={styles.profileStat}>
          <Skeleton className="h-6 w-12 mb-1 " />
          <Skeleton className="h-3 w-16 " />
        </View>
        <View style={styles.profileStat}>
          <Skeleton className="h-6 w-12 mb-1 " />
          <Skeleton className="h-3 w-16 " />
        </View>
      </View>
    </View>
  );
}

/**
 * Enhanced skeleton loader for profile section with merged card layout
 * Matches the layout of EnhancedProfileSection component
 */
export function EnhancedProfileSectionSkeleton() {
  const c = useSkeletonColors();
  return (
    <View style={[styles.enhancedProfile, c.surface]}>
      {/* Profile header row with avatar */}
      <View style={styles.enhancedProfileHeader}>
        {/* Avatar */}
        <Skeleton className="h-16 w-16 rounded-full " />
        
        {/* Name and username */}
        <View style={styles.enhancedProfileInfo}>
          <Skeleton className="h-5 w-32 mb-2 " />
          <Skeleton className="h-3 w-20 mb-1 " />
          <Skeleton className="h-3 w-28 " />
        </View>
      </View>

      {/* Bio section */}
      <View style={styles.enhancedProfileBio}>
        <Skeleton className="h-3 w-full mb-2 " />
        <Skeleton className="h-3 w-4/5 " />
      </View>

      {/* Location and portfolio links */}
      <View style={styles.enhancedProfileMeta}>
        <View style={styles.enhancedProfileMetaItem}>
          <Skeleton className="h-4 w-4 rounded " />
          <Skeleton className="h-3 w-24 ml-2 " />
        </View>
        <View style={styles.enhancedProfileMetaItem}>
          <Skeleton className="h-4 w-4 rounded " />
          <Skeleton className="h-3 w-32 ml-2 " />
        </View>
      </View>

      {/* Stats row */}
      <View style={[styles.enhancedProfileStats, c.surfaceBorderTop]}>
        <View style={styles.enhancedProfileStatItem}>
          <Skeleton className="h-7 w-10 mb-1 " />
          <Skeleton className="h-3 w-20 " />
        </View>
        <View style={styles.enhancedProfileStatItem}>
          <Skeleton className="h-7 w-10 mb-1 " />
          <Skeleton className="h-3 w-24 " />
        </View>
        <View style={styles.enhancedProfileStatItem}>
          <Skeleton className="h-7 w-10 mb-1 " />
          <Skeleton className="h-3 w-20 " />
        </View>
      </View>

      {/* Joined date */}
      <View style={styles.enhancedProfileJoined}>
        <Skeleton className="h-3 w-32 " />
      </View>
    </View>
  );
}

/**
 * Full user profile screen skeleton with action buttons
 * Used for UserProfileScreen loading state
 */
export function UserProfileScreenSkeleton() {
  return (
    <View style={styles.userProfileScreen}>
      {/* Enhanced profile section */}
      <EnhancedProfileSectionSkeleton />
      
      {/* Action buttons */}
      <View style={styles.userProfileActions}>
        <Skeleton className="h-12 flex-1 rounded-xl " />
        <Skeleton className="h-12 flex-1 rounded-xl ml-3 " />
      </View>

      {/* Skillsets section */}
      <View style={styles.userProfileSection}>
        <Skeleton className="h-4 w-20 mb-3 " />
        <View style={styles.userProfileSkillsRow}>
          <Skeleton className="h-8 w-24 rounded-lg mr-2 " />
          <Skeleton className="h-8 w-32 rounded-lg mr-2 " />
          <Skeleton className="h-8 w-28 rounded-lg " />
        </View>
      </View>

      {/* Portfolio section */}
      <View style={styles.userProfileSection}>
        <Skeleton className="h-4 w-20 mb-3 " />
        <View style={styles.userProfilePortfolioRow}>
          <Skeleton className="h-32 w-32 rounded-lg mr-3 " />
          <Skeleton className="h-32 w-32 rounded-lg mr-3 " />
          <Skeleton className="h-32 w-32 rounded-lg " />
        </View>
      </View>

      {/* Achievements section */}
      <View style={styles.userProfileSection}>
        <Skeleton className="h-4 w-28 mb-3 " />
        <View style={styles.userProfileAchievementsRow}>
          <Skeleton className="h-16 w-16 rounded-lg mr-3 " />
          <Skeleton className="h-16 w-16 rounded-lg mr-3 " />
          <Skeleton className="h-16 w-16 rounded-lg " />
        </View>
      </View>
    </View>
  );
}

/**
 * Compact profile card skeleton for use in lists
 * e.g., in conversation lists, applicant previews
 */
export function ProfileCardSkeleton() {
  const c = useSkeletonColors();
  return (
    <View style={[styles.profileCard, c.surface]}>
      <Skeleton className="h-12 w-12 rounded-full " />
      <View style={styles.profileCardInfo}>
        <Skeleton className="h-4 w-28 mb-2 " />
        <Skeleton className="h-3 w-20 " />
      </View>
    </View>
  );
}

/**
 * Skeleton loader for portfolio section
 * Used in profile screens to show loading state for portfolio items
 */
export function PortfolioSkeleton({ count = 3 }: { count?: number }) {
  return (
    <View style={styles.portfolioContainer}>
      {/* Header with title and add button */}
      <View style={styles.portfolioHeader}>
        <Skeleton className="h-4 w-20 " />
        <Skeleton className="h-6 w-16 rounded " />
      </View>
      {/* Portfolio items row */}
      <View style={styles.portfolioItems}>
        {Array.from({ length: count }).map((_, i) => (
          <Skeleton 
            key={`portfolio-skeleton-${i}`} 
            className="h-32 w-32 rounded-lg mr-3 " 
          />
        ))}
      </View>
    </View>
  );
}

/**
 * Skeleton loader for skillsets section
 */
export function SkillsetsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <View style={styles.skillsetsContainer}>
      <View style={styles.skillsetsHeader}>
        <Skeleton className="h-4 w-20 " />
        <Skeleton className="h-5 w-12 rounded " />
      </View>
      <View style={styles.skillsetsItems}>
        {Array.from({ length: count }).map((_, i) => (
          <Skeleton 
            key={`skill-skeleton-${i}`} 
            className={`h-8 ${i % 2 === 0 ? 'w-28' : 'w-36'} rounded-full mr-2 mb-2 `} 
          />
        ))}
      </View>
    </View>
  );
}

/**
 * Skeleton loader for payment method cards
 */
export function PaymentMethodSkeleton() {
  const c = useSkeletonColors();
  return (
    <View style={[styles.paymentMethod, c.surface]}>
      <Skeleton className="h-10 w-10 rounded-lg " />
      <View style={styles.paymentMethodContent}>
        <Skeleton className="h-4 w-32 mb-2 " />
        <Skeleton className="h-3 w-24 " />
      </View>
    </View>
  );
}

/**
 * Skeleton loader for bounty request/applicant cards
 */
export function ApplicantCardSkeleton() {
  const c = useSkeletonColors();
  return (
    <View style={[styles.applicantCard, c.surface]}>
      {/* Header with avatar and name */}
      <View style={styles.applicantHeader}>
        <Skeleton className="h-12 w-12 rounded-full " />
        <View style={styles.applicantInfo}>
          <Skeleton className="h-4 w-32 mb-2 " />
          <Skeleton className="h-3 w-24 " />
        </View>
      </View>
      
      {/* Message preview */}
      <Skeleton className="h-3 w-full mb-2 mt-3 " />
      <Skeleton className="h-3 w-4/5 mb-3 " />
      
      {/* Action buttons */}
      <View style={styles.applicantActions}>
        <Skeleton className="h-10 flex-1 rounded-lg mr-2 " />
        <Skeleton className="h-10 flex-1 rounded-lg " />
      </View>
    </View>
  );
}

/**
 * Multiple posting card skeletons for loading state
 */
export function PostingsListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <PostingCardSkeleton key={`posting-skeleton-${i}`} />
      ))}
    </>
  );
}

/**
 * Multiple conversation item skeletons for loading state
 */
export function ConversationsListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <ConversationItemSkeleton key={`conversation-skeleton-${i}`} />
      ))}
    </>
  );
}

/**
 * Multiple transaction item skeletons for loading state
 */
export function TransactionsListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <TransactionItemSkeleton key={`transaction-skeleton-${i}`} />
      ))}
    </>
  );
}

/**
 * Skeleton loader for hunter dashboard screens
 * Used in apply, work-in-progress, review-and-verify, and payout screens
 */
export function HunterDashboardSkeleton() {
  const c = useSkeletonColors();
  return (
    <View style={[styles.hunterDashboard, c.screen]}>
      {/* Header skeleton */}
      <View style={styles.hunterHeader}>
        <Skeleton className="h-8 w-8 rounded-lg " />
        <Skeleton className="h-6 w-40 " />
      </View>

      {/* Bounty card skeleton */}
      <View style={[styles.hunterBountyCard, c.surface, c.surfaceBorder]}>
        <View style={styles.hunterBountyHeader}>
          <Skeleton className="h-12 w-12 rounded-full " />
          <View style={styles.hunterBountyInfo}>
            <Skeleton className="h-5 w-48 " />
            <Skeleton className="h-3 w-24 " />
          </View>
        </View>
        <Skeleton className="h-7 w-20 self-end " />
      </View>

      {/* Timeline skeleton */}
      <View style={styles.hunterTimeline}>
        <Skeleton className="h-4 w-32 " />
        <View style={styles.hunterTimelineScroll}>
          {[1, 2, 3, 4].map((i) => (
            <View key={i} style={[styles.hunterStageItem, c.surface]}>
              <Skeleton className="h-12 w-12 rounded-full " />
              <Skeleton className="h-3 w-20 " />
            </View>
          ))}
        </View>
      </View>

      {/* Status panel skeleton */}
      <View style={[styles.hunterPanel, c.surface, c.surfaceBorder]}>
        <Skeleton className="h-8 w-8 rounded-full " />
        <Skeleton className="h-5 w-44 " />
        <Skeleton className="h-3 w-64 " />
        <Skeleton className="h-3 w-56 " />
        <Skeleton className="h-6 w-36 rounded-full " />
      </View>

      {/* Details card skeleton */}
      <View style={[styles.hunterDetailsCard, c.surface]}>
        <Skeleton className="h-4 w-28 " />
        <Skeleton className="h-3 w-full " />
        <Skeleton className="h-3 w-4/5 " />
        <Skeleton className="h-3 w-3/5 " />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  postingCard: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  postingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  postingHeaderText: {
    marginLeft: 12,
    flex: 1,
  },
  postingFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  conversationItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
  conversationContent: {
    marginLeft: 12,
    flex: 1,
  },
  conversationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  chatMessage: {
    padding: 12,
    borderRadius: 12,
    marginBottom: 8,
    maxWidth: '80%',
  },
  chatMessageUser: {
    alignSelf: 'flex-end',
    marginRight: 8,
  },
  chatMessageOther: {
    alignSelf: 'flex-start',
    marginLeft: 8,
  },
  transactionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
  },
  transactionIcon: {
    marginRight: 12,
  },
  transactionContent: {
    flex: 1,
  },
  profile: {
    alignItems: 'center',
    padding: 16,
  },
  profileAvatar: {
    marginBottom: 16,
  },
  profileStats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
    marginTop: 16,
  },
  profileStat: {
    alignItems: 'center',
  },
  paymentMethod: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
  },
  paymentMethodContent: {
    marginLeft: 12,
    flex: 1,
  },
  applicantCard: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  applicantHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  applicantInfo: {
    marginLeft: 12,
    flex: 1,
  },
  applicantActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  // Enhanced profile section skeleton styles
  enhancedProfile: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  enhancedProfileHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  enhancedProfileInfo: {
    marginLeft: 16,
    flex: 1,
  },
  enhancedProfileBio: {
    marginTop: 12,
  },
  enhancedProfileMeta: {
    marginTop: 12,
  },
  enhancedProfileMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  enhancedProfileStats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  enhancedProfileStatItem: {
    alignItems: 'center',
  },
  enhancedProfileJoined: {
    alignItems: 'center',
    marginTop: 12,
  },
  // User profile screen skeleton styles
  userProfileScreen: {
    paddingHorizontal: 16,
  },
  userProfileActions: {
    flexDirection: 'row',
    marginBottom: 16,
    paddingHorizontal: 16,
  },
  userProfileSection: {
    marginBottom: 16,
    paddingHorizontal: 16,
  },
  userProfileSkillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  userProfilePortfolioRow: {
    flexDirection: 'row',
  },
  userProfileAchievementsRow: {
    flexDirection: 'row',
  },
  // Profile card skeleton styles
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  profileCardInfo: {
    marginLeft: 12,
    flex: 1,
  },
  // Portfolio skeleton styles
  portfolioContainer: {
    marginBottom: 16,
  },
  portfolioHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  portfolioItems: {
    flexDirection: 'row',
  },
  // Skillsets skeleton styles
  skillsetsContainer: {
    marginBottom: 16,
  },
  skillsetsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  skillsetsItems: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  // Hunter dashboard skeleton styles
  hunterDashboard: {
    flex: 1,
    padding: 16,
  },
  hunterHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    gap: 12,
  },
  hunterBountyCard: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
  },
  hunterBountyHeader: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  hunterBountyInfo: {
    flex: 1,
    gap: 8,
  },
  hunterTimeline: {
    marginBottom: 20,
    gap: 12,
  },
  hunterTimelineScroll: {
    flexDirection: 'row',
    gap: 16,
    paddingVertical: 8,
  },
  hunterStageItem: {
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    minWidth: 120,
    gap: 8,
  },
  hunterPanel: {
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    gap: 12,
    marginBottom: 20,
    borderWidth: 1,
  },
  hunterDetailsCard: {
    borderRadius: 12,
    padding: 16,
    gap: 12,
  },
});
