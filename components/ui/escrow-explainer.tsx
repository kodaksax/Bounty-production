import { MaterialIcons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';

interface EscrowExplainerProps {
  amount?: number;
  variant?: 'inline' | 'card' | 'banner';
  showLearnMore?: boolean;
}

export function EscrowExplainer({
  amount,
  variant = 'card',
  showLearnMore = true,
}: EscrowExplainerProps) {
  const { theme } = useAppThemeContext();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const [showModal, setShowModal] = useState(false);

  return (
    <View style={[
      s.container,
      variant === 'inline' && s.inlineContainer,
      variant === 'banner' && s.bannerContainer,
    ]}>
      <View style={s.iconContainer}>
        <MaterialIcons name="shield" size={variant === 'inline' ? 20 : 28} color="#059669" />
      </View>

      <View style={s.textContainer}>
        <Text style={[s.title, variant === 'inline' && s.inlineTitle]}>
          {variant === 'banner' ? 'Your Payment is Protected' : 'Escrow Protection'}
        </Text>

        <Text style={[s.description, variant === 'inline' && s.inlineDescription]}>
          {amount
            ? `$${amount.toFixed(2)} will be held securely until the task is complete and you approve.`
            : 'Your payment is held securely until you approve the completed work.'}
        </Text>

        {showLearnMore && variant !== 'inline' && (
          <TouchableOpacity
            style={s.learnMoreButton}
            onPress={() => setShowModal(true)}
            accessibilityRole="button"
            accessibilityLabel="Learn how escrow protection works"
          >
            <Text style={s.learnMoreText}>Learn how it works</Text>
            <MaterialIcons name="arrow-forward" size={14} color={theme.primaryLight} />
          </TouchableOpacity>
        )}
      </View>

      {showLearnMore && variant === 'inline' && (
        <TouchableOpacity
          onPress={() => setShowModal(true)}
          accessibilityRole="button"
          accessibilityLabel="Learn more"
        >
          <MaterialIcons name="info-outline" size={18} color={theme.primaryLight} />
        </TouchableOpacity>
      )}

      {/* Learn More Modal */}
      <Modal
        visible={showModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowModal(false)}
        accessible={true}
        accessibilityLabel="Escrow protection explanation"
      >
        <Pressable style={s.modalOverlay} onPress={() => setShowModal(false)}>
          <Pressable style={s.modalContent} onPress={() => {}}>
            <ScrollView showsVerticalScrollIndicator={false}>
              {/* Modal Header */}
              <View style={s.modalHeader}>
                <View style={s.modalIconCircle}>
                  <MaterialIcons name="lock" size={40} color="#059669" />
                </View>
                <Text style={s.modalTitle}>Escrow Protection</Text>
                <Text style={s.modalSubtitle}>Your funds are always secure</Text>
              </View>

              {/* How It Works Steps */}
              <View style={s.stepsContainer}>
                <Text style={s.sectionTitle}>How It Works</Text>

                {[
                  { n: '1', title: 'Post Your Bounty', desc: 'When you post a bounty with a payment, the funds are securely held in escrow.' },
                  { n: '2', title: 'Work Gets Done', desc: 'A hunter accepts your bounty and completes the task according to your requirements.' },
                  { n: '3', title: 'You Approve', desc: 'Review the completed work. Only after your approval are the funds released.' },
                  { n: '4', title: 'Payment Released', desc: "Once approved, the funds are instantly transferred to the hunter's wallet." },
                ].map((step, i, arr) => (
                  <React.Fragment key={step.n}>
                    <View style={s.step}>
                      <View style={s.stepNumber}>
                        <Text style={s.stepNumberText}>{step.n}</Text>
                      </View>
                      <View style={s.stepContent}>
                        <Text style={s.stepTitle}>{step.title}</Text>
                        <Text style={s.stepDescription}>{step.desc}</Text>
                      </View>
                    </View>
                    {i < arr.length - 1 && <View style={s.stepConnector} />}
                  </React.Fragment>
                ))}
              </View>

              {/* Protection Guarantees */}
              <View style={s.guaranteesContainer}>
                <Text style={s.sectionTitle}>Your Guarantees</Text>
                {[
                  'Funds never released without your approval',
                  "Full refund if work isn't completed",
                  'Dispute resolution support available',
                  'Bank-level encryption on all transactions',
                ].map(text => (
                  <View key={text} style={s.guarantee}>
                    <MaterialIcons name="check-circle" size={20} color="#059669" />
                    <Text style={s.guaranteeText}>{text}</Text>
                  </View>
                ))}
              </View>

              {/* Payment Processing Info */}
              <View style={s.processingInfo}>
                <MaterialIcons name="credit-card" size={20} color={theme.primaryLight} />
                <Text style={s.processingText}>
                  Payments processed securely through Stripe, a PCI Level 1 certified provider.
                </Text>
              </View>
            </ScrollView>

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
    </View>
  );
}

export function EscrowProtectionBanner({ amount }: { amount?: number }) {
  const { theme } = useAppThemeContext();
  const s = useMemo(() => makeStyles(theme), [theme]);

  return (
    <View style={s.protectionBanner}>
      <MaterialIcons name="lock" size={14} color="#059669" />
      <Text style={s.protectionBannerText}>
        {amount ? `$${amount.toFixed(2)} protected` : 'Escrow protected'}
      </Text>
      <MaterialIcons name="verified-user" size={12} color="#059669" />
    </View>
  );
}

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    container: {
      backgroundColor: t.isDark ? 'rgba(16,185,129,0.1)' : t.surface,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: t.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(5,150,105,0.35)',
      padding: 16,
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 12,
    },
    inlineContainer: {
      backgroundColor: 'transparent',
      borderWidth: 0,
      padding: 8,
      alignItems: 'center',
    },
    bannerContainer: {
      backgroundColor: t.isDark ? '#111827' : t.surface,
      borderColor: '#059669',
    },
    iconContainer: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: t.surfaceSecondary,
      justifyContent: 'center',
      alignItems: 'center',
    },
    textContainer: {
      flex: 1,
    },
    title: {
      fontSize: 16,
      fontWeight: '700',
      color: t.text,
      marginBottom: 4,
    },
    inlineTitle: {
      fontSize: 14,
      marginBottom: 2,
    },
    description: {
      fontSize: 13,
      color: t.textSecondary,
      lineHeight: 20,
      marginBottom: 8,
    },
    inlineDescription: {
      fontSize: 12,
      marginBottom: 0,
    },
    learnMoreButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    learnMoreText: {
      fontSize: 13,
      fontWeight: '600',
      color: t.isDark ? '#6ee7b7' : t.primary,
    },
    protectionBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: t.isDark ? 'rgba(16,185,129,0.1)' : t.surfaceSecondary,
      borderWidth: 1,
      borderColor: t.isDark ? 'rgba(110,231,183,0.2)' : t.border,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 16,
      gap: 6,
      alignSelf: 'flex-start',
    },
    protectionBannerText: {
      fontSize: 11,
      fontWeight: '600',
      color: t.primary,
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
      maxWidth: 380,
      maxHeight: '85%',
    },
    modalHeader: {
      alignItems: 'center',
      marginBottom: 24,
    },
    modalIconCircle: {
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor: t.surfaceSecondary,
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: 16,
    },
    modalTitle: {
      fontSize: 24,
      fontWeight: '800',
      color: t.text,
      marginBottom: 8,
    },
    modalSubtitle: {
      fontSize: 14,
      color: t.textSecondary,
      textAlign: 'center',
    },
    sectionTitle: {
      fontSize: 14,
      fontWeight: '700',
      color: t.isDark ? '#6ee7b7' : t.primary,
      textTransform: 'uppercase',
      letterSpacing: 1,
      marginBottom: 16,
    },
    stepsContainer: {
      marginBottom: 24,
    },
    step: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 12,
    },
    stepNumber: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: '#059669',
      justifyContent: 'center',
      alignItems: 'center',
    },
    stepNumberText: {
      fontSize: 16,
      fontWeight: '700',
      color: '#fff',
    },
    stepContent: {
      flex: 1,
    },
    stepTitle: {
      fontSize: 15,
      fontWeight: '600',
      color: t.text,
      marginBottom: 4,
    },
    stepDescription: {
      fontSize: 13,
      color: t.textSecondary,
      lineHeight: 20,
    },
    stepConnector: {
      width: 2,
      height: 24,
      backgroundColor: t.border,
      marginLeft: 15,
      marginVertical: 8,
    },
    guaranteesContainer: {
      backgroundColor: t.isDark ? 'rgba(6,78,59,0.5)' : 'rgba(5,150,105,0.07)',
      borderRadius: 12,
      padding: 16,
      marginBottom: 16,
    },
    guarantee: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginBottom: 10,
    },
    guaranteeText: {
      fontSize: 13,
      color: t.text,
      flex: 1,
    },
    processingInfo: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: t.isDark ? 'rgba(6,78,59,0.3)' : t.surfaceSecondary,
      borderRadius: 8,
      padding: 12,
      gap: 10,
      marginBottom: 20,
    },
    processingText: {
      fontSize: 11,
      color: t.textSecondary,
      flex: 1,
      lineHeight: 16,
    },
    closeButton: {
      backgroundColor: '#059669',
      paddingVertical: 14,
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
