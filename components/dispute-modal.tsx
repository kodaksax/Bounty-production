import { MaterialIcons } from "@expo/vector-icons";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

interface DisputeModalProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: () => Promise<void>;
  bountyTitle: string;
  transactionId?: string;
}

const SUPPORT_EMAIL = "Support@bountyfinder.app";

export function DisputeModal({
  visible,
  onClose,
  onSubmit,
  bountyTitle,
  transactionId,
}: DisputeModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  const handleSubmit = async () => {
    try {
      setIsSubmitting(true);
      setError(null);
      await onSubmit();
      onClose();
      setShowConfirm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to open dispute");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!isSubmitting) {
      setShowConfirm(false);
      setError(null);
      onClose();
    }
  };

  const handleContactSupport = () => {
    Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=Dispute: ${bountyTitle}`);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <View style={styles.overlay}>
        <View style={styles.modal}>
          {/* Header */}
          <View style={styles.header}>
            <MaterialIcons name="report-problem" size={24} color="#fbbf24" />
            <Text style={styles.title}>Open Dispute</Text>
            <TouchableOpacity
              onPress={handleClose}
              disabled={isSubmitting}
              style={styles.closeButton}
            >
              <MaterialIcons name="close" size={24} color="#d5ecdc" />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.content}
            contentContainerStyle={styles.contentContainer}
          >
            {!showConfirm ? (
              <>
                {/* Info */}
                <View style={styles.infoCard}>
                  <Text style={styles.bountyTitle} numberOfLines={2}>
                    {bountyTitle}
                  </Text>
                  {transactionId && (
                    <Text style={styles.transactionId}>
                      Transaction: {transactionId.substring(0, 8)}...
                    </Text>
                  )}
                </View>

                {/* Guidance */}
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>What happens next?</Text>
                  <View style={styles.step}>
                    <View style={styles.stepNumber}>
                      <Text style={styles.stepNumberText}>1</Text>
                    </View>
                    <Text style={styles.stepText}>
                      Your dispute will be marked as "pending" and both parties will be
                      notified
                    </Text>
                  </View>
                  <View style={styles.step}>
                    <View style={styles.stepNumber}>
                      <Text style={styles.stepNumberText}>2</Text>
                    </View>
                    <Text style={styles.stepText}>
                      Funds will remain in escrow until the dispute is resolved
                    </Text>
                  </View>
                  <View style={styles.step}>
                    <View style={styles.stepNumber}>
                      <Text style={styles.stepNumberText}>3</Text>
                    </View>
                    <Text style={styles.stepText}>
                      Our support team will review the case and reach out within 24-48
                      hours
                    </Text>
                  </View>
                </View>

                {/* Support contact */}
                <View style={styles.supportCard}>
                  <MaterialIcons name="support-agent" size={20} color="#008e2a" />
                  <View style={styles.supportTextContainer}>
                    <Text style={styles.supportLabel}>Need help now?</Text>
                    <TouchableOpacity onPress={handleContactSupport}>
                      <Text style={styles.supportEmail}>{SUPPORT_EMAIL}</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Error */}
                {error && (
                  <View style={styles.errorBanner}>
                    <MaterialIcons name="error-outline" size={16} color="#fff" />
                    <Text style={styles.errorText}>{error}</Text>
                  </View>
                )}

                {/* Actions */}
                <TouchableOpacity
                  style={styles.primaryButton}
                  onPress={() => setShowConfirm(true)}
                  disabled={isSubmitting}
                >
                  <Text style={styles.primaryButtonText}>Continue</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.secondaryButton}
                  onPress={handleClose}
                  disabled={isSubmitting}
                >
                  <Text style={styles.secondaryButtonText}>Cancel</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                {/* Confirmation step */}
                <View style={styles.confirmCard}>
                  <MaterialIcons name="warning" size={32} color="#fbbf24" />
                  <Text style={styles.confirmTitle}>Confirm Dispute</Text>
                  <Text style={styles.confirmText}>
                    Are you sure you want to open a dispute for this bounty? This
                    action will notify both parties and our support team.
                  </Text>
                </View>

                {/* Error */}
                {error && (
                  <View style={styles.errorBanner}>
                    <MaterialIcons name="error-outline" size={16} color="#fff" />
                    <Text style={styles.errorText}>{error}</Text>
                  </View>
                )}

                {/* Actions */}
                <TouchableOpacity
                  style={[styles.primaryButton, styles.dangerButton]}
                  onPress={handleSubmit}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.primaryButtonText}>
                      Yes, Open Dispute
                    </Text>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.secondaryButton}
                  onPress={() => setShowConfirm(false)}
                  disabled={isSubmitting}
                >
                  <Text style={styles.secondaryButtonText}>Go Back</Text>
                </TouchableOpacity>
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modal: {
    backgroundColor: "#007523", // emerald-700
    borderRadius: 16,
    width: "100%",
    maxWidth: 400,
    maxHeight: "90%",
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#008e2a",
    gap: 8,
  },
  title: {
    flex: 1,
    fontSize: 18,
    fontWeight: "700",
    color: "#fff",
  },
  closeButton: {
    padding: 4,
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 20,
  },
  infoCard: {
    backgroundColor: "#005c1c",
    padding: 16,
    borderRadius: 12,
    marginBottom: 24,
  },
  bountyTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
    marginBottom: 4,
  },
  transactionId: {
    fontSize: 12,
    color: "#aad9b8",
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
    marginBottom: 16,
  },
  step: {
    flexDirection: "row",
    marginBottom: 12,
    alignItems: "flex-start",
  },
  stepNumber: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#008e2a",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  stepNumberText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
  },
  stepText: {
    flex: 1,
    color: "#d5ecdc",
    fontSize: 14,
    lineHeight: 20,
  },
  supportCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#005c1c",
    padding: 16,
    borderRadius: 12,
    marginBottom: 20,
    gap: 12,
  },
  supportTextContainer: {
    flex: 1,
  },
  supportLabel: {
    fontSize: 12,
    color: "#aad9b8",
    marginBottom: 2,
  },
  supportEmail: {
    fontSize: 14,
    fontWeight: "600",
    color: "#008e2a",
    textDecorationLine: "underline",
  },
  confirmCard: {
    backgroundColor: "#005c1c",
    padding: 24,
    borderRadius: 12,
    alignItems: "center",
    marginBottom: 24,
  },
  confirmTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#fff",
    marginTop: 12,
    marginBottom: 8,
  },
  confirmText: {
    fontSize: 14,
    color: "#d5ecdc",
    textAlign: "center",
    lineHeight: 20,
  },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#dc2626",
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
    gap: 8,
  },
  errorText: {
    flex: 1,
    color: "#fff",
    fontSize: 14,
  },
  primaryButton: {
    backgroundColor: "#008e2a",
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
    marginBottom: 12,
  },
  dangerButton: {
    backgroundColor: "#dc2626",
  },
  primaryButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  secondaryButton: {
    padding: 12,
    alignItems: "center",
  },
  secondaryButtonText: {
    color: "#aad9b8",
    fontSize: 14,
  },
});
