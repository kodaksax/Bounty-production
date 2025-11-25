import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Skeleton } from './skeleton';

/**
 * Skeleton loader for posting cards
 */
export function PostingCardSkeleton() {
  return (
    <View style={styles.postingCard}>
      {/* Header: avatar and name */}
      <View style={styles.postingHeader}>
        <Skeleton className="h-10 w-10 rounded-full bg-emerald-700/40" />
        <View style={styles.postingHeaderText}>
          <Skeleton className="h-4 w-24 mb-2 bg-emerald-700/40" />
          <Skeleton className="h-3 w-16 bg-emerald-700/40" />
        </View>
      </View>
      
      {/* Title */}
      <Skeleton className="h-5 w-full mb-2 bg-emerald-700/40" />
      
      {/* Description lines */}
      <Skeleton className="h-3 w-full mb-2 bg-emerald-700/40" />
      <Skeleton className="h-3 w-4/5 mb-3 bg-emerald-700/40" />
      
      {/* Amount and location */}
      <View style={styles.postingFooter}>
        <Skeleton className="h-4 w-20 bg-emerald-700/40" />
        <Skeleton className="h-4 w-24 bg-emerald-700/40" />
      </View>
    </View>
  );
}

/**
 * Skeleton loader for conversation items
 */
export function ConversationItemSkeleton() {
  return (
    <View style={styles.conversationItem}>
      <Skeleton className="h-12 w-12 rounded-full bg-emerald-700/40" />
      <View style={styles.conversationContent}>
        <View style={styles.conversationHeader}>
          <Skeleton className="h-4 w-32 bg-emerald-700/40" />
          <Skeleton className="h-3 w-12 bg-emerald-700/40" />
        </View>
        <Skeleton className="h-3 w-48 mt-2 bg-emerald-700/40" />
      </View>
    </View>
  );
}

/**
 * Skeleton loader for individual chat messages
 */
export function ChatMessageSkeleton({ isUser = false }: { isUser?: boolean }) {
  return (
    <View style={[styles.chatMessage, isUser ? styles.chatMessageUser : styles.chatMessageOther]}>
      <Skeleton className="h-3 w-48 mb-1 bg-emerald-700/40" />
      <Skeleton className="h-3 w-32 bg-emerald-700/40" />
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
  return (
    <View style={styles.transactionItem}>
      <View style={styles.transactionIcon}>
        <Skeleton className="h-10 w-10 rounded-lg bg-emerald-700/40" />
      </View>
      <View style={styles.transactionContent}>
        <Skeleton className="h-4 w-40 mb-2 bg-emerald-700/40" />
        <Skeleton className="h-3 w-24 bg-emerald-700/40" />
      </View>
      <Skeleton className="h-5 w-16 bg-emerald-700/40" />
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
        <Skeleton className="h-20 w-20 rounded-full bg-emerald-700/40" />
      </View>
      
      {/* Name and bio */}
      <Skeleton className="h-6 w-40 mb-2 bg-emerald-700/40" />
      <Skeleton className="h-4 w-56 mb-3 bg-emerald-700/40" />
      
      {/* Stats */}
      <View style={styles.profileStats}>
        <View style={styles.profileStat}>
          <Skeleton className="h-6 w-12 mb-1 bg-emerald-700/40" />
          <Skeleton className="h-3 w-16 bg-emerald-700/40" />
        </View>
        <View style={styles.profileStat}>
          <Skeleton className="h-6 w-12 mb-1 bg-emerald-700/40" />
          <Skeleton className="h-3 w-16 bg-emerald-700/40" />
        </View>
        <View style={styles.profileStat}>
          <Skeleton className="h-6 w-12 mb-1 bg-emerald-700/40" />
          <Skeleton className="h-3 w-16 bg-emerald-700/40" />
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
  return (
    <View style={styles.enhancedProfile}>
      {/* Profile header row with avatar */}
      <View style={styles.enhancedProfileHeader}>
        {/* Avatar */}
        <Skeleton className="h-16 w-16 rounded-full bg-emerald-700/40" />
        
        {/* Name and username */}
        <View style={styles.enhancedProfileInfo}>
          <Skeleton className="h-5 w-32 mb-2 bg-emerald-700/40" />
          <Skeleton className="h-3 w-20 mb-1 bg-emerald-700/40" />
          <Skeleton className="h-3 w-28 bg-emerald-700/40" />
        </View>
      </View>

      {/* Bio section */}
      <View style={styles.enhancedProfileBio}>
        <Skeleton className="h-3 w-full mb-2 bg-emerald-700/40" />
        <Skeleton className="h-3 w-4/5 bg-emerald-700/40" />
      </View>

      {/* Location and portfolio links */}
      <View style={styles.enhancedProfileMeta}>
        <View style={styles.enhancedProfileMetaItem}>
          <Skeleton className="h-4 w-4 rounded bg-emerald-700/40" />
          <Skeleton className="h-3 w-24 ml-2 bg-emerald-700/40" />
        </View>
        <View style={styles.enhancedProfileMetaItem}>
          <Skeleton className="h-4 w-4 rounded bg-emerald-700/40" />
          <Skeleton className="h-3 w-32 ml-2 bg-emerald-700/40" />
        </View>
      </View>

      {/* Stats row */}
      <View style={styles.enhancedProfileStats}>
        <View style={styles.enhancedProfileStatItem}>
          <Skeleton className="h-7 w-10 mb-1 bg-emerald-700/40" />
          <Skeleton className="h-3 w-20 bg-emerald-700/40" />
        </View>
        <View style={styles.enhancedProfileStatItem}>
          <Skeleton className="h-7 w-10 mb-1 bg-emerald-700/40" />
          <Skeleton className="h-3 w-24 bg-emerald-700/40" />
        </View>
        <View style={styles.enhancedProfileStatItem}>
          <Skeleton className="h-7 w-10 mb-1 bg-emerald-700/40" />
          <Skeleton className="h-3 w-20 bg-emerald-700/40" />
        </View>
      </View>

      {/* Joined date */}
      <View style={styles.enhancedProfileJoined}>
        <Skeleton className="h-3 w-32 bg-emerald-700/40" />
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
        <Skeleton className="h-12 flex-1 rounded-xl bg-emerald-700/40" />
        <Skeleton className="h-12 flex-1 rounded-xl ml-3 bg-emerald-700/40" />
      </View>

      {/* Skillsets section */}
      <View style={styles.userProfileSection}>
        <Skeleton className="h-4 w-20 mb-3 bg-emerald-700/40" />
        <View style={styles.userProfileSkillsRow}>
          <Skeleton className="h-8 w-24 rounded-lg mr-2 bg-emerald-700/40" />
          <Skeleton className="h-8 w-32 rounded-lg mr-2 bg-emerald-700/40" />
          <Skeleton className="h-8 w-28 rounded-lg bg-emerald-700/40" />
        </View>
      </View>

      {/* Portfolio section */}
      <View style={styles.userProfileSection}>
        <Skeleton className="h-4 w-20 mb-3 bg-emerald-700/40" />
        <View style={styles.userProfilePortfolioRow}>
          <Skeleton className="h-32 w-32 rounded-lg mr-3 bg-emerald-700/40" />
          <Skeleton className="h-32 w-32 rounded-lg mr-3 bg-emerald-700/40" />
          <Skeleton className="h-32 w-32 rounded-lg bg-emerald-700/40" />
        </View>
      </View>

      {/* Achievements section */}
      <View style={styles.userProfileSection}>
        <Skeleton className="h-4 w-28 mb-3 bg-emerald-700/40" />
        <View style={styles.userProfileAchievementsRow}>
          <Skeleton className="h-16 w-16 rounded-lg mr-3 bg-emerald-700/40" />
          <Skeleton className="h-16 w-16 rounded-lg mr-3 bg-emerald-700/40" />
          <Skeleton className="h-16 w-16 rounded-lg bg-emerald-700/40" />
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
  return (
    <View style={styles.profileCard}>
      <Skeleton className="h-12 w-12 rounded-full bg-emerald-700/40" />
      <View style={styles.profileCardInfo}>
        <Skeleton className="h-4 w-28 mb-2 bg-emerald-700/40" />
        <Skeleton className="h-3 w-20 bg-emerald-700/40" />
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
        <Skeleton className="h-4 w-20 bg-emerald-700/40" />
        <Skeleton className="h-6 w-16 rounded bg-emerald-700/40" />
      </View>
      {/* Portfolio items row */}
      <View style={styles.portfolioItems}>
        {Array.from({ length: count }).map((_, i) => (
          <Skeleton 
            key={`portfolio-skeleton-${i}`} 
            className="h-32 w-32 rounded-lg mr-3 bg-emerald-700/40" 
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
        <Skeleton className="h-4 w-20 bg-emerald-700/40" />
        <Skeleton className="h-5 w-12 rounded bg-emerald-700/40" />
      </View>
      <View style={styles.skillsetsItems}>
        {Array.from({ length: count }).map((_, i) => (
          <Skeleton 
            key={`skill-skeleton-${i}`} 
            className={`h-8 ${i % 2 === 0 ? 'w-28' : 'w-36'} rounded-full mr-2 mb-2 bg-emerald-700/40`} 
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
  return (
    <View style={styles.paymentMethod}>
      <Skeleton className="h-10 w-10 rounded-lg bg-emerald-700/40" />
      <View style={styles.paymentMethodContent}>
        <Skeleton className="h-4 w-32 mb-2 bg-emerald-700/40" />
        <Skeleton className="h-3 w-24 bg-emerald-700/40" />
      </View>
    </View>
  );
}

/**
 * Skeleton loader for bounty request/applicant cards
 */
export function ApplicantCardSkeleton() {
  return (
    <View style={styles.applicantCard}>
      {/* Header with avatar and name */}
      <View style={styles.applicantHeader}>
        <Skeleton className="h-12 w-12 rounded-full bg-emerald-700/40" />
        <View style={styles.applicantInfo}>
          <Skeleton className="h-4 w-32 mb-2 bg-emerald-700/40" />
          <Skeleton className="h-3 w-24 bg-emerald-700/40" />
        </View>
      </View>
      
      {/* Message preview */}
      <Skeleton className="h-3 w-full mb-2 mt-3 bg-emerald-700/40" />
      <Skeleton className="h-3 w-4/5 mb-3 bg-emerald-700/40" />
      
      {/* Action buttons */}
      <View style={styles.applicantActions}>
        <Skeleton className="h-10 flex-1 rounded-lg mr-2 bg-emerald-700/40" />
        <Skeleton className="h-10 flex-1 rounded-lg bg-emerald-700/40" />
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

const styles = StyleSheet.create({
  postingCard: {
    backgroundColor: 'rgba(4, 120, 87, 0.3)',
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
    backgroundColor: 'rgba(4, 120, 87, 0.2)',
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
    backgroundColor: 'rgba(4, 120, 87, 0.3)',
    marginRight: 8,
  },
  chatMessageOther: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(4, 120, 87, 0.2)',
    marginLeft: 8,
  },
  transactionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(4, 120, 87, 0.8)',
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
    backgroundColor: 'rgba(4, 120, 87, 0.8)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
  },
  paymentMethodContent: {
    marginLeft: 12,
    flex: 1,
  },
  applicantCard: {
    backgroundColor: 'rgba(4, 120, 87, 0.3)',
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
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
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
    borderTopColor: 'rgba(16, 185, 129, 0.3)',
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
    backgroundColor: 'rgba(4, 120, 87, 0.2)',
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
});
