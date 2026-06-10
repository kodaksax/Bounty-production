import { MaterialIcons } from '@expo/vector-icons';
import React, { useState, useCallback, useMemo } from 'react';
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useHapticFeedback } from '../../lib/haptic-feedback';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';

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
  label: string;
  title: string;
  description: string;
}

const VERIFICATION_CONFIGS: Record<VerificationLevel, VerificationConfig> = {
  verified: {
    icon: 'verified',
    color: '#059669',
    label: 'Verified',
    title: 'Verified Account',
    description: 'This user has completed identity verification through our secure process. Their email is confirmed, and their payment methods are validated. You can trust transactions with verified users.',
  },
  pending: {
    icon: 'schedule',
    color: '#fbbf24',
    label: 'Pending',
    title: 'Verification Pending',
    description: 'This user has submitted their verification documents and is awaiting review. The verification process typically takes 1-2 business days.',
  },
  unverified: {
    icon: 'help-outline',
    color: '#9ca3af',
    label: 'Unverified',
    title: 'Not Yet Verified',
    description: 'This user has not yet completed the verification process. Consider asking for additional proof of identity before engaging in transactions.',
  },
};

function getBadgeBg(status: VerificationLevel, isDark: boolean): string {
  if (status === 'verified') return isDark ? 'rgba(255,255,255,0.05)' : 'rgba(5,150,105,0.1)';
  if (status === 'pending') return 'rgba(251,191,36,0.15)';
  return isDark ? 'rgba(156,163,175,0.15)' : 'rgba(156,163,175,0.12)';
}

export function VerificationBadge({
  status,
  size = 'medium',
  showLabel = true,
  showExplanation = true,
}: VerificationBadgeProps) {
  const { theme } = useAppThemeContext();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const [showModal, setShowModal] = useState(false);
  const { triggerHaptic } = useHapticFeedback();
  const config = VERIFICATION_CONFIGS[status];
  const badgeBg = getBadgeBg(status, theme.isDark);

  const iconSize = size === 'small' ? 14 : size === 'large' ? 24 : 18;
  const fontSize = size === 'small' ? 10 : size === 'large' ? 14 : 12;

  const handlePress = useCallback(() => {
    triggerHaptic('light');
    setShowModal(true);
  }, [triggerHaptic]);

  const BadgeContent = (
    <View style={[s.badge, { backgroundColor: badgeBg }]}>
      <MaterialIcons name={config.icon} size={iconSize} color={config.color} />
      {showLabel && (
        <Text style={[s.label, { color: config.color, fontSize }]}>
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
        <Pressable style={s.modalOverlay} onPress={() => setShowModal(false)}>
          <Pressable style={s.modalContent} onPress={() => {}}>
            <View style={s.modalHeader}>
              <View style={[s.modalIconCircle, { backgroundColor: badgeBg }]}>
                <MaterialIcons name={config.icon} size={32} color={config.color} />
              </View>
              <Text style={s.modalTitle}>{config.title}</Text>
            </View>

            <Text style={s.modalDescription}>{config.description}</Text>

            {status === 'verified' && (
              <View style={s.verificationDetails}>
                <View style={s.detailRow}>
                  <MaterialIcons name="check-circle" size={16} color="#059669" />
                  <Text style={s.detailText}>Email confirmed</Text>
                </View>
                <View style={s.detailRow}>
                  <MaterialIcons name="check-circle" size={16} color="#059669" />
                  <Text style={s.detailText}>Payment method validated</Text>
                </View>
                <View style={s.detailRow}>
                  <MaterialIcons name="check-circle" size={16} color="#059669" />
                  <Text style={s.detailText}>Identity verified</Text>
                </View>
              </View>
            )}

            {status === 'unverified' && (
              <View style={s.tipBox}>
                <MaterialIcons name="lightbulb-outline" size={16} color="#fbbf24" />
                <Text style={s.tipText}>
                  Tip: Verified users complete transactions 3x faster and have higher trust ratings.
                </Text>
              </View>
            )}

            <TouchableOpacity
              style={s.closeButton}
              onPress={() => setShowModal(false)}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Text style={s.closeButtonText}>Got it</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
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
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'center',
      alignItems: 'center',
      padding: 20,
    },
    modalContent: {
      backgroundColor: t.surface,
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
      color: t.text,
      textAlign: 'center',
    },
    modalDescription: {
      fontSize: 14,
      color: t.textSecondary,
      lineHeight: 22,
      textAlign: 'center',
      marginBottom: 16,
    },
    verificationDetails: {
      backgroundColor: t.isDark ? 'rgba(16,185,129,0.1)' : 'rgba(5,150,105,0.07)',
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
      color: t.textSecondary,
    },
    tipBox: {
      flexDirection: 'row',
      backgroundColor: 'rgba(251,191,36,0.1)',
      borderRadius: 12,
      padding: 12,
      marginBottom: 16,
      gap: 8,
      alignItems: 'flex-start',
    },
    tipText: {
      flex: 1,
      fontSize: 12,
      color: t.isDark ? '#fef3c7' : '#92400e',
      lineHeight: 18,
    },
    closeButton: {
      backgroundColor: '#059669',
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
