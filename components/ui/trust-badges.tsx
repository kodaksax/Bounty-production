import { MaterialIcons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import React, { useState, useCallback } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useHapticFeedback } from '../../lib/haptic-feedback';

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

const PLATFORM_BADGES: TrustBadge[] = [
  {
    id: 'escrow-protected',
    icon: 'lock',
    title: 'Escrow Protected',
    description: 'All payments are held securely in escrow until work is verified and approved. Your funds are never released without your explicit approval.',
    color: '#10b981',
  },
  {
    id: 'secure-payments',
    icon: 'credit-card',
    title: 'Secure Payments',
    description: 'Payments are processed through Stripe, a PCI Level 1 certified payment processor. Your payment information is encrypted and never stored on our servers.',
    color: '#3b82f6',
  },
  {
    id: 'dispute-resolution',
    icon: 'gavel',
    title: 'Dispute Resolution',
    description: 'Our dedicated support team helps mediate any disputes between posters and hunters. We ensure fair outcomes for both parties.',
    color: '#8b5cf6',
  },
  {
    id: 'verified-users',
    icon: 'verified-user',
    title: 'Verified Users',
    description: 'Users can verify their identity through our secure verification process, adding an extra layer of trust to transactions.',
    color: '#06b6d4',
  },
  {
    id: 'encrypted-messaging',
    icon: 'security',
    title: 'Encrypted Messaging',
    description: 'All messages between users are secured. Your conversations and shared information remain private and protected.',
    color: '#14b8a6',
  },
  {
    id: 'refund-guarantee',
    icon: 'replay',
    title: 'Refund Guarantee',
    description: 'If work is not completed satisfactorily, escrowed funds are refunded. We protect both posters and hunters from unfair outcomes.',
    color: '#f59e0b',
  },
];

export function TrustBadges({
  badges = [],
  showPlatformBadges = true,
  compact = false,
}: TrustBadgesProps) {
  const [selectedBadge, setSelectedBadge] = useState<TrustBadge | null>(null);
  const { triggerHaptic } = useHapticFeedback();
  
  const allBadges = showPlatformBadges ? [...PLATFORM_BADGES, ...badges] : badges;

  if (allBadges.length === 0) return null;

  const handleBadgePress = useCallback((badge: TrustBadge) => {
    triggerHaptic('light');
    setSelectedBadge(badge);
  }, [triggerHaptic]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        {/* ↓ CHANGED: icon color #F8F9FA → #059669 */}
        <MaterialIcons name="shield" size={18} color="#059669" />
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
              // ↓ CHANGED: chevron color #6ee7b7 → #059669
              <MaterialIcons name="chevron-right" size={20} color="#059669" />
            )}
          </TouchableOpacity>
        ))}
      </View>

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
                    <MaterialIcons name={selectedBadge.icon} size={40} color={selectedBadge.color} />
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

export function TrustBadgesCompact() {
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
                    <MaterialIcons name={selectedBadge.icon} size={40} color={selectedBadge.color} />
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

const styles = StyleSheet.create({
  container: {
    // ↓ CHANGED: rgba(5,95,70,0.3) → #F8F9FA with a subtle emerald border
    backgroundColor: '#F8F9FA',
    borderWidth: 1,
    borderColor: '#d1fae5',
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
    // ↓ CHANGED: #fff → #1a1a1a
    color: '#1a1a1a',
  },
  subtitle: {
    fontSize: 12,
    // ↓ CHANGED: #a7f3d0 → #059669
    color: '#059669',
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
    // ↓ CHANGED: rgba(6,78,59,0.5) → #ffffff with border
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
  },
  listBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    // ↓ CHANGED: rgba(6,78,59,0.5) → #ffffff with border
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
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
    // ↓ CHANGED: #fff → #1a1a1a
    color: '#1a1a1a',
    marginBottom: 2,
  },
  badgePreview: {
    fontSize: 12,
    // ↓ CHANGED: #a7f3d0 → #6b7280
    color: '#6b7280',
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
    // ↓ CHANGED: rgba(5,95,70,0.3) → #F8F9FA with border
    backgroundColor: '#F8F9FA',
    borderWidth: 1,
    borderColor: '#d1fae5',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    gap: 6,
  },
  compactBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    // ↓ CHANGED: #d1fae5 → #059669
    color: '#059669',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    // ↓ CHANGED: #065f46 (dark emerald) → #ffffff (white modal on light theme)
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 340,
    // subtle shadow so it lifts off the overlay
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 8,
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
    // ↓ CHANGED: #fff → #1a1a1a
    color: '#1a1a1a',
    textAlign: 'center',
  },
  modalDescription: {
    fontSize: 14,
    // ↓ CHANGED: #d1fae5 → #4b5563
    color: '#4b5563',
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