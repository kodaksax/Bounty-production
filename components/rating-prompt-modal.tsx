import { MaterialIcons } from "@expo/vector-icons";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

interface RatingPromptModalProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (rating: { score: 1 | 2 | 3 | 4 | 5; comment?: string }) => Promise<void>;
  userName: string; // Name of person being rated
  bountyTitle: string;
}

export function RatingPromptModal({
  visible,
  onClose,
  onSubmit,
  userName,
  bountyTitle,
}: RatingPromptModalProps) {
  const [score, setScore] = useState<1 | 2 | 3 | 4 | 5 | null>(null);
  const [comment, setComment] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!score) {
      setError("Please select a rating");
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);
      await onSubmit({ score, comment: comment.trim() || undefined });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit rating");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!isSubmitting) {
      setScore(null);
      setComment("");
      setError(null);
      onClose();
    }
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
            <Text style={styles.title}>Rate this experience</Text>
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
            {/* Bounty info */}
            <View style={styles.infoCard}>
              <Text style={styles.bountyTitle} numberOfLines={2}>
                {bountyTitle}
              </Text>
              <Text style={styles.userName}>with {userName}</Text>
            </View>

            {/* Star rating */}
            <View style={styles.starsContainer}>
              <Text style={styles.label}>How was your experience?</Text>
              <View style={styles.stars}>
                {[1, 2, 3, 4, 5].map((star) => (
                  <TouchableOpacity
                    key={star}
                    onPress={() => setScore(star as 1 | 2 | 3 | 4 | 5)}
                    disabled={isSubmitting}
                    style={styles.starButton}
                  >
                    <MaterialIcons
                      name={score && star <= score ? "star" : "star-border"}
                      size={40}
                      color={score && star <= score ? "#fcd34d" : "#80c795"}
                    />
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Comment */}
            <View style={styles.commentContainer}>
              <Text style={styles.label}>Add a comment (optional)</Text>
              <TextInput
                style={styles.commentInput}
                placeholder="Share your thoughts..."
                placeholderTextColor="#80c79580"
                value={comment}
                onChangeText={setComment}
                multiline
                numberOfLines={4}
                maxLength={500}
                editable={!isSubmitting}
              />
              <Text style={styles.charCount}>{comment.length}/500</Text>
            </View>

            {/* Error */}
            {error && (
              <View style={styles.errorBanner}>
                <MaterialIcons name="error-outline" size={16} color="#fff" />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            {/* Submit button */}
            <TouchableOpacity
              style={[styles.submitButton, !score && styles.submitButtonDisabled]}
              onPress={handleSubmit}
              disabled={!score || isSubmitting}
            >
              {isSubmitting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.submitButtonText}>Submit Rating</Text>
              )}
            </TouchableOpacity>

            {/* Skip button */}
            <TouchableOpacity
              style={styles.skipButton}
              onPress={handleClose}
              disabled={isSubmitting}
            >
              <Text style={styles.skipButtonText}>Skip for now</Text>
            </TouchableOpacity>
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
    justifyContent: "space-between",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#008e2a",
  },
  title: {
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
  userName: {
    fontSize: 14,
    color: "#aad9b8",
  },
  starsContainer: {
    marginBottom: 24,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: "#d5ecdc",
    marginBottom: 12,
  },
  stars: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
  },
  starButton: {
    padding: 4,
  },
  commentContainer: {
    marginBottom: 20,
  },
  commentInput: {
    backgroundColor: "#005c1c",
    borderRadius: 12,
    padding: 12,
    color: "#fff",
    fontSize: 14,
    minHeight: 100,
    textAlignVertical: "top",
    borderWidth: 1,
    borderColor: "#008e2a",
  },
  charCount: {
    fontSize: 12,
    color: "#80c795",
    textAlign: "right",
    marginTop: 4,
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
  submitButton: {
    backgroundColor: "#008e2a",
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
    marginBottom: 12,
  },
  submitButtonDisabled: {
    backgroundColor: "#6b7280",
    opacity: 0.5,
  },
  submitButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  skipButton: {
    padding: 12,
    alignItems: "center",
  },
  skipButtonText: {
    color: "#aad9b8",
    fontSize: 14,
  },
});
