import { MaterialIcons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export interface TrustBadge {
  id: string;
  icon: string;
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
    title: 'Escrow Protected',
    description: 'All payments are held securely in escrow until work is verified and approved. Your funds are never released without your explicit approval.',
    color: '#10b981', // emerald-500
  },
  {
    id: 'secure-payments',
    icon: 'credit-card',
    title: 'Secure Payments',
    description: 'Payments are processed through Stripe, a PCI Level 1 certified payment processor. Your payment information is encrypted and never stored on our servers.',
    color: '#3b82f6', // blue-500
  },
  {
    id: 'dispute-resolution',
    icon: 'gavel',
    title: 'Dispute Resolution',
    description: 'Our dedicated support team helps mediate any disputes between posters and hunters. We ensure fair outcomes for both parties.',
    color: '#8b5cf6', // violet-500
  },
  {
    id: 'verified-users',
    icon: 'verified-user',
    title: 'Verified Users',
    description: 'Users can verify their identity through our secure verification process, adding an extra layer of trust to transactions.',
    color: '#06b6d4', // cyan-500
  },
  {
    id: 'encrypted-messaging',
    icon: 'security',
    title: 'Encrypted Messaging',
    description: 'All messages between users are secured. Your conversations and shared information remain private and protected.',
    color: '#14b8a6', // teal-500
  },
  {
    id: 'refund-guarantee',
    icon: 'replay',
    title: 'Refund Guarantee',
    description: 'If work is not completed satisfactorily, escrowed funds are refunded. We protect both posters and hunters from unfair outcomes.',
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
  const [selectedBadge, setSelectedBadge] = useState<TrustBadge | null>(null);
  
  const allBadges = showPlatformBadges ? [...PLATFORM_BADGES, ...badges] : badges;

  if (allBadges.length === 0) {
    return null;
  }

  const handleBadgePress = (badge: TrustBadge) => {
    setSelectedBadge(badge);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <MaterialIcons name="shield" size={18} color="#6ee7b7" />
        <Text style={styles.title}>Platform Security</Text>
      </View>
      
      <Text style={styles.subtitle}>
        Tap any badge to learn more about our security measures
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
              <MaterialIcons name={badge.icon as any} size={compact ? 20 : 24} color={badge.color} />
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
              <MaterialIcons name="chevron-right" size={20} color="#6ee7b7" />
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
                      name={selectedBadge.icon as any} 
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
  const [selectedBadge, setSelectedBadge] = useState<TrustBadge | null>(null);

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
            onPress={() => setSelectedBadge(badge)}
            accessibilityRole="button"
            accessibilityLabel={badge.title}
          >
            <MaterialIcons name={badge.icon as any} size={16} color={badge.color} />
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
                      name={selectedBadge.icon as any} 
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

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'rgba(5, 95, 70, 0.3)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
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
    color: '#fff',
  },
  subtitle: {
    fontSize: 12,
    color: '#a7f3d0',
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
    backgroundColor: 'rgba(6, 78, 59, 0.5)',
    borderRadius: 12,
  },
  listBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: 'rgba(6, 78, 59, 0.5)',
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
    color: '#fff',
    marginBottom: 2,
  },
  badgePreview: {
    fontSize: 12,
    color: '#a7f3d0',
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
    backgroundColor: 'rgba(5, 95, 70, 0.3)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    gap: 6,
  },
  compactBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#d1fae5',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#065f46', // emerald-800
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
    color: '#fff',
    textAlign: 'center',
  },
  modalDescription: {
    fontSize: 14,
    color: '#d1fae5',
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
