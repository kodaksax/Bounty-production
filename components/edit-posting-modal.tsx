import { MaterialIcons } from "@expo/vector-icons";
import type { Bounty } from "lib/services/database.types";
import React, { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

interface EditPostingModalProps {
  visible: boolean;
  bounty: Bounty;
  onClose: () => void;
  onSave: (updates: Partial<Bounty>) => Promise<void>;
}

export function EditPostingModal({
  visible,
  bounty,
  onClose,
  onSave,
}: EditPostingModalProps) {
  const insets = useSafeAreaInsets();
  const [formData, setFormData] = useState({
    title: bounty.title,
    description: bounty.description,
    amount: bounty.amount,
    isForHonor: bounty.is_for_honor,
    location: bounty.location || "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    // Validation
    if (!formData.title.trim()) {
      setError("Title is required");
      return;
    }
    if (!formData.description.trim()) {
      setError("Description is required");
      return;
    }
    if (!formData.isForHonor && formData.amount <= 0) {
      setError("Amount must be greater than 0");
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);
      
      await onSave({
        title: formData.title.trim(),
        description: formData.description.trim(),
        amount: formData.isForHonor ? 0 : formData.amount,
        is_for_honor: formData.isForHonor,
        location: formData.location.trim() || undefined,
      });
      
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update posting");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!isSubmitting) {
      // Reset form data to original values
      setFormData({
        title: bounty.title,
        description: bounty.description,
        amount: bounty.amount,
        isForHonor: bounty.is_for_honor,
        location: bounty.location || "",
      });
      setError(null);
      onClose();
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.container}
      >
        <View style={styles.overlay}>
          <View style={styles.modal}>
            {/* Header */}
            <View style={styles.header}>
              <Text style={styles.title}>Edit Posting</Text>
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
              contentContainerStyle={[
                styles.contentContainer,
                // ensure actions aren't clipped behind bottom nav / home indicator
                { paddingBottom: Math.max(insets.bottom, 16) + 60 },
              ]}
              keyboardShouldPersistTaps="handled"
            >
              {/* Title */}
              <View style={styles.field}>
                <Text style={styles.label}>Title *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Enter title"
                  placeholderTextColor="#80c79580"
                  value={formData.title}
                  onChangeText={(text) =>
                    setFormData({ ...formData, title: text })
                  }
                  maxLength={100}
                  editable={!isSubmitting}
                />
              </View>

              {/* Description */}
              <View style={styles.field}>
                <Text style={styles.label}>Description *</Text>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  placeholder="Describe what you need"
                  placeholderTextColor="#80c79580"
                  value={formData.description}
                  onChangeText={(text) =>
                    setFormData({ ...formData, description: text })
                  }
                  multiline
                  numberOfLines={4}
                  maxLength={1000}
                  editable={!isSubmitting}
                />
              </View>

              {/* For Honor toggle */}
              <TouchableOpacity
                style={styles.toggleRow}
                onPress={() =>
                  setFormData({ ...formData, isForHonor: !formData.isForHonor })
                }
                disabled={isSubmitting}
              >
                <View style={styles.toggleLeft}>
                  <MaterialIcons name="favorite" size={20} color="#008e2a" />
                  <Text style={styles.toggleLabel}>For Honor</Text>
                </View>
                <View
                  style={[
                    styles.toggle,
                    formData.isForHonor && styles.toggleActive,
                  ]}
                >
                  <View
                    style={[
                      styles.toggleThumb,
                      formData.isForHonor && styles.toggleThumbActive,
                    ]}
                  />
                </View>
              </TouchableOpacity>

              {/* Amount (only if not for honor) */}
              {!formData.isForHonor && (
                <View style={styles.field}>
                  <Text style={styles.label}>Amount ($) *</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="0"
                    placeholderTextColor="#80c79580"
                    value={String(formData.amount || "")}
                    onChangeText={(text) => {
                      const num = parseFloat(text) || 0;
                      setFormData({ ...formData, amount: num });
                    }}
                    keyboardType="numeric"
                    editable={!isSubmitting}
                  />
                </View>
              )}

              {/* Location */}
              <View style={styles.field}>
                <Text style={styles.label}>Location (optional)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Enter location"
                  placeholderTextColor="#80c79580"
                  value={formData.location}
                  onChangeText={(text) =>
                    setFormData({ ...formData, location: text })
                  }
                  maxLength={100}
                  editable={!isSubmitting}
                />
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
                style={styles.saveButton}
                onPress={handleSave}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.saveButtonText}>Save Changes</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.cancelButton}
                onPress={handleClose}
                disabled={isSubmitting}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    justifyContent: "flex-end",
  },
  modal: {
    backgroundColor: "#007523", // emerald-700
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    // Use a fixed relative height so content gets layout below the header
    height: "90%",
    width: "100%",
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: "#008e2a",
  },
  title: {
    fontSize: 20,
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
  field: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: "#d5ecdc",
    marginBottom: 8,
  },
  input: {
    backgroundColor: "#005c1c",
    borderRadius: 12,
    padding: 12,
    color: "#fff",
    fontSize: 16,
    borderWidth: 1,
    borderColor: "#008e2a",
  },
  textArea: {
    minHeight: 100,
    textAlignVertical: "top",
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#005c1c",
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  toggleLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  toggleLabel: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },
  toggle: {
    width: 52,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#6b7280",
    padding: 2,
    justifyContent: "center",
  },
  toggleActive: {
    backgroundColor: "#008e2a",
  },
  toggleThumb: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#fff",
  },
  toggleThumbActive: {
    alignSelf: "flex-end",
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
  saveButton: {
    backgroundColor: "#008e2a",
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
    marginBottom: 12,
  },
  saveButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  cancelButton: {
    padding: 12,
    alignItems: "center",
  },
  cancelButtonText: {
    color: "#aad9b8",
    fontSize: 14,
  },
});
