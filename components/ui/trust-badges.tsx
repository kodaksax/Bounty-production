import { MaterialIcons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import React, { useState, useCallback, useMemo } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useHapticFeedback } from '../../lib/haptic-feedback';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';
import { trustSafetyStrings } from '../../lib/strings/trust-safety';

// Type for MaterialIcons icon names
type MaterialIconName = ComponentProps<typeof MaterialIcons>['name'];

export interface TrustBadge {
  id: string;
  icon: MaterialIconName;
  title: string;
  description: string;
  color: string;
}

interface TrustBadgesProps {
  badges?: TrustBadge[];
  showPlatformBadges?: boolean;
  compact?: boolean;
}

// Platform-level trust and security badges
const PLATFORM_BADGES: TrustBadge[] = [
  {
    id: 'escrow-protected',
    icon: 'lock',
    title: 'In-App Escrow',
    description: 'Funds handled through Bounty may be authorized or captured at posting or acceptance. An open listing does not prove funding. Releases depend on bounty state and any dispute review.',
    color: '#059669', // emerald-500
  },
  {
    id: 'secure-payments',
    icon: 'credit-card',
    title: 'In-App Payments',
    description: `In-app payments are processed through Stripe. ${trustSafetyStrings.paymentProtection}`,
    color: '#3b82f6', // blue-500
  },
  {
    id: 'dispute-resolution',
    icon: 'gavel',
    title: 'Dispute Review',
    description: 'Report problems in Bounty for review. Refunds and releases depend on bounty state and the review outcome; no particular outcome is guaranteed.',
    color: '#8b5cf6', // violet-500
  },
  {
    id: 'verified-users',
    icon: 'verified-user',
    title: 'Verified Users',
    description: 'Stripe identity checks support payout setup. They are not background checks or guarantees of a user’s skills or conduct.',
    color: '#06b6d4', // cyan-500
  },
  {
    id: 'encrypted-messaging',
    icon: 'security',
    title: 'In-App Messaging',
    description: 'Keep job agreements and updates in Bounty so they can support a dispute review. Do not move payment or the agreement outside the app.',
    color: '#14b8a6', // teal-500
  },
  {
    id: 'refund-guarantee',
    icon: 'replay',
    title: 'Refund Review',
    description: trustSafetyStrings.escrowLimits,
    color: '#f59e0b', // amber-500
  },
];

/**
 * TrustBadges - Displays platform security certifications and trust indicators
 * 
 * @param badges - Custom badges to display
 * @param showPlatformBadges - Whether to show default platform trust badges
 * @param compact - Whether to use compact display (grid vs list)
 */
export function TrustBadges({
  badges = [],
  showPlatformBadges = true,
  compact = false,
}: TrustBadgesProps) {
  const { theme } = useAppThemeContext();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [selectedBadge, setSelectedBadge] = useState<TrustBadge | null>(null);
  const { triggerHaptic } = useHapticFeedback();
  
  const allBadges = showPlatformBadges ? [...PLATFORM_BADGES, ...badges] : badges;

  if (allBadges.length === 0) {
    return null;
  }

  const handleBadgePress = useCallback((badge: TrustBadge) => {
    triggerHaptic('light');
    setSelectedBadge(badge);
  }, [triggerHaptic]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <MaterialIcons name="shield" size={18} color={theme.primary} />
        <Text style={styles.title}>In-App Trust and Safety</Text>
      </View>
      
      <Text style={styles.subtitle}>
        Tap a badge for payment scope and review limits
      </Text>

      <View style={compact ? styles.gridContainer : styles.listContainer}>
        {allBadges.map((badge) => (
          <TouchableOpacity
            key={badge.id}
            style={compact ? styles.gridBadge : styles.listBadge}
            onPress={() => handleBadgePress(badge)}
            accessibilityRole="button"
            accessibilityLabel={badge.title}
            accessibilityHint={`Learn more about ${badge.title}`}
          >
            <View style={[styles.badgeIconCircle, { backgroundColor: `${badge.color}20` }]}>
              <MaterialIcons name={badge.icon} size={compact ? 20 : 24} color={badge.color} />
            </View>
            {!compact && (
              <View style={styles.badgeTextContainer}>
                <Text style={styles.badgeTitle}>{badge.title}</Text>
                <Text style={styles.badgePreview} numberOfLines={1}>
                  {badge.description}
                </Text>
              </View>
            )}
            {!compact && (
              <MaterialIcons name="chevron-right" size={20} color={theme.primary} />
            )}
          </TouchableOpacity>
        ))}
      </View>

      {/* Badge Detail Modal */}
      <Modal
        visible={!!selectedBadge}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedBadge(null)}
        accessible={true}
        accessibilityLabel="Security badge details"
      >
        <Pressable 
          style={styles.modalOverlay}
          onPress={() => setSelectedBadge(null)}
        >
          <Pressable style={styles.modalContent} onPress={() => {}}>
            {selectedBadge && (
              <>
                <View style={styles.modalHeader}>
                  <View style={[styles.modalIconCircle, { backgroundColor: `${selectedBadge.color}20` }]}>
                    <MaterialIcons 
                      name={selectedBadge.icon} 
                      size={40} 
                      color={selectedBadge.color} 
                    />
                  </View>
                  <Text style={styles.modalTitle}>{selectedBadge.title}</Text>
                </View>
                
                <Text style={styles.modalDescription}>{selectedBadge.description}</Text>

                <TouchableOpacity 
                  style={[styles.closeButton, { backgroundColor: selectedBadge.color }]}
                  onPress={() => setSelectedBadge(null)}
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                >
                  <Text style={styles.closeButtonText}>Got it</Text>
                </TouchableOpacity>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

/**
 * TrustBadgesCompact - Compact horizontal scrollable version of trust badges
 * Used in areas with limited vertical space
 */
export function TrustBadgesCompact() {
  const { theme } = useAppThemeContext();
  const styles = makeStyles(theme);
  const [selectedBadge, setSelectedBadge] = useState<TrustBadge | null>(null);
  const { triggerHaptic } = useHapticFeedback();

  const handleBadgePress = useCallback((badge: TrustBadge) => {
    triggerHaptic('light');
    setSelectedBadge(badge);
  }, [triggerHaptic]);

  return (
    <View style={styles.compactContainer}>
      <ScrollView 
        horizontal 
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.compactScrollContent}
      >
        {PLATFORM_BADGES.slice(0, 4).map((badge) => (
          <TouchableOpacity
            key={badge.id}
            style={styles.compactBadge}
            onPress={() => handleBadgePress(badge)}
            accessibilityRole="button"
            accessibilityLabel={badge.title}
            accessibilityHint={`Learn more about ${badge.title}`}
          >
            <MaterialIcons name={badge.icon} size={16} color={badge.color} />
            <Text style={styles.compactBadgeText}>{badge.title}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Detail Modal */}
      <Modal
        visible={!!selectedBadge}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedBadge(null)}
        accessible={true}
        accessibilityLabel="Security badge details"
      >
        <Pressable 
          style={styles.modalOverlay}
          onPress={() => setSelectedBadge(null)}
        >
          <Pressable style={styles.modalContent} onPress={() => {}}>
            {selectedBadge && (
              <>
                <View style={styles.modalHeader}>
                  <View style={[styles.modalIconCircle, { backgroundColor: `${selectedBadge.color}20` }]}>
                    <MaterialIcons 
                      name={selectedBadge.icon} 
                      size={40} 
                      color={selectedBadge.color} 
                    />
                  </View>
                  <Text style={styles.modalTitle}>{selectedBadge.title}</Text>
                </View>
                
                <Text style={styles.modalDescription}>{selectedBadge.description}</Text>

                <TouchableOpacity 
                  style={[styles.closeButton, { backgroundColor: selectedBadge.color }]}
                  onPress={() => setSelectedBadge(null)}
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                >
                  <Text style={styles.closeButtonText}>Got it</Text>
                </TouchableOpacity>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
    container: {
      backgroundColor: theme.isDark ? 'rgba(5,95,70,0.3)' : theme.surface,
      borderRadius: 16,
      padding: 16,
      marginBottom: 16,
      borderWidth: 1,
      borderColor: theme.isDark ? 'rgba(167,243,208,0.3)' : 'rgba(5,150,105,0.35)',
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 4,
    },
    title: {
      fontSize: 16,
      fontWeight: '700',
      color: theme.text,
    },
    subtitle: {
      fontSize: 12,
      color: theme.textSecondary,
      marginBottom: 16,
    },
    gridContainer: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 12,
    },
    listContainer: {
      gap: 12,
    },
    gridBadge: {
      width: '30%',
      alignItems: 'center',
      padding: 12,
      backgroundColor: theme.isDark ? 'rgba(6,78,59,0.5)' : theme.surfaceSecondary,
      borderRadius: 12,
    },
    listBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 12,
      backgroundColor: theme.isDark ? 'rgba(6,78,59,0.5)' : theme.surfaceSecondary,
      borderRadius: 12,
      gap: 12,
    },
    badgeIconCircle: {
      width: 48,
      height: 48,
      borderRadius: 24,
      justifyContent: 'center',
      alignItems: 'center',
    },
    badgeTextContainer: {
      flex: 1,
    },
    badgeTitle: {
      fontSize: 14,
      fontWeight: '600',
      color: theme.text,
      marginBottom: 2,
    },
    badgePreview: {
      fontSize: 12,
      color: theme.textSecondary,
    },
    compactContainer: {
      marginVertical: 8,
    },
    compactScrollContent: {
      gap: 8,
      paddingHorizontal: 4,
    },
    compactBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.isDark ? 'rgba(5,95,70,0.3)' : theme.surfaceSecondary,
      borderWidth: 1,
      borderColor: theme.isDark ? 'rgba(167,243,208,0.15)' : theme.border,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 16,
      gap: 6,
    },
    compactBadgeText: {
      fontSize: 11,
      fontWeight: '600',
      color: theme.text,
    },
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'center',
      alignItems: 'center',
      padding: 20,
    },
    modalContent: {
      backgroundColor: theme.surface,
      borderRadius: 16,
      padding: 24,
      width: '100%',
      maxWidth: 340,
    },
    modalHeader: {
      alignItems: 'center',
      marginBottom: 16,
    },
    modalIconCircle: {
      width: 80,
      height: 80,
      borderRadius: 40,
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: 16,
    },
    modalTitle: {
      fontSize: 20,
      fontWeight: '700',
      color: theme.text,
      textAlign: 'center',
    },
    modalDescription: {
      fontSize: 14,
      color: theme.textSecondary,
      lineHeight: 22,
      textAlign: 'center',
      marginBottom: 20,
    },
    closeButton: {
      paddingVertical: 12,
      borderRadius: 8,
      alignItems: 'center',
    },
    closeButtonText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: '600',
    },
  });
}
