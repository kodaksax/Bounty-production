import { MaterialIcons } from '@expo/vector-icons';
import React, { useState, useCallback } from 'react';
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useHapticFeedback } from '../../lib/haptic-feedback';

export type VerificationLevel = 'unverified' | 'pending' | 'verified';

interface VerificationBadgeProps {
  status: VerificationLevel;
  size?: 'small' | 'medium' | 'large';
  showLabel?: boolean;
  showExplanation?: boolean;
}

interface VerificationConfig {
  icon: 'verified' | 'schedule' | 'help-outline';
  color: string;
  backgroundColor: string;
  label: string;
  title: string;
  description: string;
}

const VERIFICATION_CONFIGS: Record<VerificationLevel, VerificationConfig> = {
  verified: {
    icon: 'verified',
    color: '#10b981', // emerald-500
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    label: 'Verified',
    title: 'Verified Account',
    description: 'This user has completed identity verification through our secure process. Their email is confirmed, and their payment methods are validated. You can trust transactions with verified users.',
  },
  pending: {
    icon: 'schedule',
    color: '#fbbf24', // amber-400
    backgroundColor: 'rgba(251, 191, 36, 0.15)',
    label: 'Pending',
    title: 'Verification Pending',
    description: 'This user has submitted their verification documents and is awaiting review. The verification process typically takes 1-2 business days.',
  },
  unverified: {
    icon: 'help-outline',
    color: '#9ca3af', // gray-400
    backgroundColor: 'rgba(156, 163, 175, 0.15)',
    label: 'Unverified',
    title: 'Not Yet Verified',
    description: 'This user has not yet completed the verification process. Consider asking for additional proof of identity before engaging in transactions.',
  },
};

/**
 * VerificationBadge - Visual badge showing user verification status with explanatory tooltip
 * 
 * @param status - The verification status ('unverified' | 'pending' | 'verified')
 * @param size - Size of the badge ('small' | 'medium' | 'large')
 * @param showLabel - Whether to show the text label next to the icon
 * @param showExplanation - Whether to enable tap-to-explain functionality
 */
export function VerificationBadge({
  status,
  size = 'medium',
  showLabel = true,
  showExplanation = true,
}: VerificationBadgeProps) {
  const [showModal, setShowModal] = useState(false);
  const { triggerHaptic } = useHapticFeedback();
  const config = VERIFICATION_CONFIGS[status];
  
  const iconSize = size === 'small' ? 14 : size === 'large' ? 24 : 18;
  const fontSize = size === 'small' ? 10 : size === 'large' ? 14 : 12;

  const handlePress = useCallback(() => {
    triggerHaptic('light');
    setShowModal(true);
  }, [triggerHaptic]);
  
  const BadgeContent = (
    <View style={[styles.badge, { backgroundColor: config.backgroundColor }]}>
      <MaterialIcons name={config.icon} size={iconSize} color={config.color} />
      {showLabel && (
        <Text style={[styles.label, { color: config.color, fontSize }]}>
          {config.label}
        </Text>
      )}
      {showExplanation && (
        <MaterialIcons 
          name="info-outline" 
          size={size === 'small' ? 10 : 12} 
          color={config.color} 
          style={{ opacity: 0.7, marginLeft: 2 }}
        />
      )}
    </View>
  );

  if (!showExplanation) {
    return BadgeContent;
  }

  return (
    <>
      <TouchableOpacity 
        onPress={handlePress}
        accessibilityRole="button"
        accessibilityLabel={`${config.label} status. Tap for more information.`}
        accessibilityHint="Opens a dialog explaining what this verification status means"
      >
        {BadgeContent}
      </TouchableOpacity>

      <Modal
        visible={showModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowModal(false)}
        accessible={true}
        accessibilityLabel="Verification status explanation"
      >
        <Pressable 
          style={styles.modalOverlay} 
          onPress={() => setShowModal(false)}
        >
          <Pressable style={styles.modalContent} onPress={() => {}}>
            <View style={styles.modalHeader}>
              <View style={[styles.modalIconCircle, { backgroundColor: config.backgroundColor }]}>
                <MaterialIcons name={config.icon} size={32} color={config.color} />
              </View>
              <Text style={styles.modalTitle}>{config.title}</Text>
            </View>
            
            <Text style={styles.modalDescription}>{config.description}</Text>
            
            {status === 'verified' && (
              <View style={styles.verificationDetails}>
                <View style={styles.detailRow}>
                  <MaterialIcons name="check-circle" size={16} color="#10b981" />
                  <Text style={styles.detailText}>Email confirmed</Text>
                </View>
                <View style={styles.detailRow}>
                  <MaterialIcons name="check-circle" size={16} color="#10b981" />
                  <Text style={styles.detailText}>Payment method validated</Text>
                </View>
                <View style={styles.detailRow}>
                  <MaterialIcons name="check-circle" size={16} color="#10b981" />
                  <Text style={styles.detailText}>Identity verified</Text>
                </View>
              </View>
            )}

            {status === 'unverified' && (
              <View style={styles.tipBox}>
                <MaterialIcons name="lightbulb-outline" size={16} color="#fbbf24" />
                <Text style={styles.tipText}>
                  Tip: Verified users complete transactions 3x faster and have higher trust ratings.
                </Text>
              </View>
            )}

            <TouchableOpacity 
              style={styles.closeButton}
              onPress={() => setShowModal(false)}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Text style={styles.closeButtonText}>Got it</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  label: {
    fontWeight: '600',
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
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
    textAlign: 'center',
  },
  modalDescription: {
    fontSize: 14,
    color: '#d1fae5', // emerald-100
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 16,
  },
  verificationDetails: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    gap: 8,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  detailText: {
    fontSize: 13,
    color: '#a7f3d0', // emerald-200
  },
  tipBox: {
    flexDirection: 'row',
    backgroundColor: 'rgba(251, 191, 36, 0.1)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    gap: 8,
    alignItems: 'flex-start',
  },
  tipText: {
    flex: 1,
    fontSize: 12,
    color: '#fef3c7', // amber-100
    lineHeight: 18,
  },
  closeButton: {
    backgroundColor: '#10b981', // emerald-500
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
