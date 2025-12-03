import { MaterialIcons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

interface EscrowExplainerProps {
  amount?: number;
  variant?: 'inline' | 'card' | 'banner';
  showLearnMore?: boolean;
}

/**
 * EscrowExplainer - Explains escrow protection during bounty creation
 * 
 * @param amount - The escrow amount (optional)
 * @param variant - Display variant ('inline' | 'card' | 'banner')
 * @param showLearnMore - Whether to show the learn more button/modal
 */
export function EscrowExplainer({
  amount,
  variant = 'card',
  showLearnMore = true,
}: EscrowExplainerProps) {
  const [showModal, setShowModal] = useState(false);

  const Content = (
    <View style={[
      styles.container,
      variant === 'inline' && styles.inlineContainer,
      variant === 'banner' && styles.bannerContainer,
    ]}>
      <View style={styles.iconContainer}>
        <MaterialIcons name="shield" size={variant === 'inline' ? 20 : 28} color="#10b981" />
      </View>
      
      <View style={styles.textContainer}>
        <Text style={[styles.title, variant === 'inline' && styles.inlineTitle]}>
          {variant === 'banner' ? 'Your Payment is Protected' : 'Escrow Protection'}
        </Text>
        
        <Text style={[styles.description, variant === 'inline' && styles.inlineDescription]}>
          {amount 
            ? `$${amount.toFixed(2)} will be held securely until the task is complete and you approve.`
            : 'Your payment is held securely until you approve the completed work.'}
        </Text>

        {showLearnMore && variant !== 'inline' && (
          <TouchableOpacity 
            style={styles.learnMoreButton}
            onPress={() => setShowModal(true)}
            accessibilityRole="button"
            accessibilityLabel="Learn how escrow protection works"
          >
            <Text style={styles.learnMoreText}>Learn how it works</Text>
            <MaterialIcons name="arrow-forward" size={14} color="#6ee7b7" />
          </TouchableOpacity>
        )}
      </View>

      {showLearnMore && variant === 'inline' && (
        <TouchableOpacity 
          onPress={() => setShowModal(true)}
          accessibilityRole="button"
          accessibilityLabel="Learn more"
        >
          <MaterialIcons name="info-outline" size={18} color="#6ee7b7" />
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
        <Pressable 
          style={styles.modalOverlay}
          onPress={() => setShowModal(false)}
        >
          <Pressable style={styles.modalContent} onPress={() => {}}>
            <ScrollView showsVerticalScrollIndicator={false}>
              {/* Modal Header */}
              <View style={styles.modalHeader}>
                <View style={styles.modalIconCircle}>
                  <MaterialIcons name="lock" size={40} color="#10b981" />
                </View>
                <Text style={styles.modalTitle}>Escrow Protection</Text>
                <Text style={styles.modalSubtitle}>
                  Your funds are always secure
                </Text>
              </View>

              {/* How It Works Steps */}
              <View style={styles.stepsContainer}>
                <Text style={styles.sectionTitle}>How It Works</Text>
                
                <View style={styles.step}>
                  <View style={styles.stepNumber}>
                    <Text style={styles.stepNumberText}>1</Text>
                  </View>
                  <View style={styles.stepContent}>
                    <Text style={styles.stepTitle}>Post Your Bounty</Text>
                    <Text style={styles.stepDescription}>
                      When you post a bounty with a payment, the funds are securely held in escrow.
                    </Text>
                  </View>
                </View>

                <View style={styles.stepConnector} />

                <View style={styles.step}>
                  <View style={styles.stepNumber}>
                    <Text style={styles.stepNumberText}>2</Text>
                  </View>
                  <View style={styles.stepContent}>
                    <Text style={styles.stepTitle}>Work Gets Done</Text>
                    <Text style={styles.stepDescription}>
                      A hunter accepts your bounty and completes the task according to your requirements.
                    </Text>
                  </View>
                </View>

                <View style={styles.stepConnector} />

                <View style={styles.step}>
                  <View style={styles.stepNumber}>
                    <Text style={styles.stepNumberText}>3</Text>
                  </View>
                  <View style={styles.stepContent}>
                    <Text style={styles.stepTitle}>You Approve</Text>
                    <Text style={styles.stepDescription}>
                      Review the completed work. Only after your approval are the funds released.
                    </Text>
                  </View>
                </View>

                <View style={styles.stepConnector} />

                <View style={styles.step}>
                  <View style={styles.stepNumber}>
                    <Text style={styles.stepNumberText}>4</Text>
                  </View>
                  <View style={styles.stepContent}>
                    <Text style={styles.stepTitle}>Payment Released</Text>
                    <Text style={styles.stepDescription}>
                      Once approved, the funds are instantly transferred to the hunter's wallet.
                    </Text>
                  </View>
                </View>
              </View>

              {/* Protection Guarantees */}
              <View style={styles.guaranteesContainer}>
                <Text style={styles.sectionTitle}>Your Guarantees</Text>
                
                <View style={styles.guarantee}>
                  <MaterialIcons name="check-circle" size={20} color="#10b981" />
                  <Text style={styles.guaranteeText}>
                    Funds never released without your approval
                  </Text>
                </View>
                
                <View style={styles.guarantee}>
                  <MaterialIcons name="check-circle" size={20} color="#10b981" />
                  <Text style={styles.guaranteeText}>
                    Full refund if work isn't completed
                  </Text>
                </View>
                
                <View style={styles.guarantee}>
                  <MaterialIcons name="check-circle" size={20} color="#10b981" />
                  <Text style={styles.guaranteeText}>
                    Dispute resolution support available
                  </Text>
                </View>
                
                <View style={styles.guarantee}>
                  <MaterialIcons name="check-circle" size={20} color="#10b981" />
                  <Text style={styles.guaranteeText}>
                    Bank-level encryption on all transactions
                  </Text>
                </View>
              </View>

              {/* Payment Processing Info */}
              <View style={styles.processingInfo}>
                <MaterialIcons name="credit-card" size={20} color="#6ee7b7" />
                <Text style={styles.processingText}>
                  Payments processed securely through Stripe, a PCI Level 1 certified provider.
                </Text>
              </View>
            </ScrollView>

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
    </View>
  );

  return Content;
}

/**
 * EscrowProtectionBanner - Compact banner version for bounty cards
 */
export function EscrowProtectionBanner({ amount }: { amount?: number }) {
  return (
    <View style={styles.protectionBanner}>
      <MaterialIcons name="lock" size={14} color="#10b981" />
      <Text style={styles.protectionBannerText}>
        {amount ? `$${amount.toFixed(2)} protected` : 'Escrow protected'}
      </Text>
      <MaterialIcons name="verified-user" size={12} color="#10b981" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
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
    backgroundColor: '#065f46',
    borderColor: '#10b981',
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  textContainer: {
    flex: 1,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 4,
  },
  inlineTitle: {
    fontSize: 14,
    marginBottom: 2,
  },
  description: {
    fontSize: 13,
    color: '#a7f3d0',
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
    color: '#6ee7b7',
  },
  protectionBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    gap: 6,
    alignSelf: 'flex-start',
  },
  protectionBannerText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#10b981',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#065f46',
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
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#fff',
    marginBottom: 8,
  },
  modalSubtitle: {
    fontSize: 14,
    color: '#a7f3d0',
    textAlign: 'center',
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#6ee7b7',
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
    backgroundColor: '#10b981',
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
    color: '#fff',
    marginBottom: 4,
  },
  stepDescription: {
    fontSize: 13,
    color: '#a7f3d0',
    lineHeight: 20,
  },
  stepConnector: {
    width: 2,
    height: 24,
    backgroundColor: 'rgba(16, 185, 129, 0.3)',
    marginLeft: 15,
    marginVertical: 8,
  },
  guaranteesContainer: {
    backgroundColor: 'rgba(6, 78, 59, 0.5)',
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
    color: '#d1fae5',
    flex: 1,
  },
  processingInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(6, 78, 59, 0.3)',
    borderRadius: 8,
    padding: 12,
    gap: 10,
    marginBottom: 20,
  },
  processingText: {
    fontSize: 11,
    color: '#a7f3d0',
    flex: 1,
    lineHeight: 16,
  },
  closeButton: {
    backgroundColor: '#10b981',
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
