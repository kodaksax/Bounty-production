import { MaterialIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useProfile } from "hooks/useProfile";
import { getCurrentUserId } from "lib/utils/data-utils";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuthContext } from "../../hooks/use-auth-context";

export default function EditProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuthContext();
  const currentUserId = getCurrentUserId();
  
  const { profile, loading, error, updateProfile } = useProfile(currentUserId);

  const [formData, setFormData] = useState({
    name: profile?.name || "",
    username: profile?.username || "",
    title: profile?.title || "",
    bio: profile?.bio || "",
    languages: profile?.languages?.join(", ") || "",
    skills: profile?.skills?.join(", ") || "",
  });

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dismissedError, setDismissedError] = useState(false);

  React.useEffect(() => {
    if (profile) {
      setFormData({
        name: profile.name || "",
        username: profile.username || "",
        title: profile.title || "",
        bio: profile.bio || "",
        languages: profile.languages?.join(", ") || "",
        skills: profile.skills?.join(", ") || "",
      });
    }
  }, [profile]);

  const handleSave = async () => {
    try {
      setSaving(true);
      setSaveError(null);
      setDismissedError(false);

      // Parse comma-separated values
      const languages = formData.languages
        .split(",")
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

      const skills = formData.skills
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      await updateProfile({
        name: formData.name,
        username: formData.username,
        title: formData.title,
        bio: formData.bio,
        languages,
        skills,
      });

      Alert.alert("Success", "Profile updated successfully!", [
        { text: "OK", onPress: () => router.back() },
      ]);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save profile");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#10b981" />
          <Text style={styles.loadingText}>Loading profile...</Text>
        </View>
      </View>
    );
  }

  const displayError = !dismissedError && (error || saveError);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <MaterialIcons name="arrow-back" size={24} color="#fffef5" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Edit Profile</Text>
        <TouchableOpacity
          onPress={handleSave}
          disabled={saving}
          style={styles.saveButton}
        >
          {saving ? (
            <ActivityIndicator size="small" color="#10b981" />
          ) : (
            <Text style={styles.saveButtonText}>Save</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Error Banner */}
      {displayError && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>{error || saveError}</Text>
          <TouchableOpacity onPress={() => setDismissedError(true)}>
            <MaterialIcons name="close" size={20} color="#fff" />
          </TouchableOpacity>
        </View>
      )}

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 100 }]}
      >
        {/* Avatar Placeholder */}
        <View style={styles.avatarSection}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {formData.name?.[0]?.toUpperCase() || formData.username[1]?.toUpperCase() || "U"}
            </Text>
          </View>
          <TouchableOpacity style={styles.changeAvatarButton}>
            <MaterialIcons name="camera-alt" size={20} color="#10b981" />
            <Text style={styles.changeAvatarText}>Change Photo</Text>
          </TouchableOpacity>
          <Text style={styles.avatarHelp}>Avatar upload coming soon</Text>
        </View>

        {/* Form Fields */}
        <View style={styles.formSection}>
          <Text style={styles.label}>Display Name</Text>
          <TextInput
            style={styles.input}
            value={formData.name}
            onChangeText={(text) => setFormData({ ...formData, name: text })}
            placeholder="Your name"
            placeholderTextColor="#6b7280"
          />
        </View>

        <View style={styles.formSection}>
          <Text style={styles.label}>Username</Text>
          <TextInput
            style={styles.input}
            value={formData.username}
            onChangeText={(text) => setFormData({ ...formData, username: text })}
            placeholder="@username"
            placeholderTextColor="#6b7280"
            autoCapitalize="none"
          />
        </View>

        <View style={styles.formSection}>
          <Text style={styles.label}>Title</Text>
          <TextInput
            style={styles.input}
            value={formData.title}
            onChangeText={(text) => setFormData({ ...formData, title: text })}
            placeholder="e.g., Full Stack Developer"
            placeholderTextColor="#6b7280"
          />
        </View>

        <View style={styles.formSection}>
          <Text style={styles.label}>Bio</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={formData.bio}
            onChangeText={(text) => setFormData({ ...formData, bio: text })}
            placeholder="Tell others about yourself..."
            placeholderTextColor="#6b7280"
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />
        </View>

        <View style={styles.formSection}>
          <Text style={styles.label}>Languages</Text>
          <TextInput
            style={styles.input}
            value={formData.languages}
            onChangeText={(text) => setFormData({ ...formData, languages: text })}
            placeholder="e.g., English, Spanish"
            placeholderTextColor="#6b7280"
          />
          <Text style={styles.helpText}>Separate with commas</Text>
        </View>

        <View style={styles.formSection}>
          <Text style={styles.label}>Skills</Text>
          <TextInput
            style={styles.input}
            value={formData.skills}
            onChangeText={(text) => setFormData({ ...formData, skills: text })}
            placeholder="e.g., React, Node.js, Design"
            placeholderTextColor="#6b7280"
          />
          <Text style={styles.helpText}>Separate with commas</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#1a3d2e",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#1a3d2e",
  },
  backButton: {
    marginRight: 12,
  },
  headerTitle: {
    flex: 1,
    fontSize: 20,
    fontWeight: "bold",
    color: "#fffef5",
    letterSpacing: 1,
  },
  saveButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#10b981",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: "#d1d5db",
  },
  errorBanner: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#dc2626",
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 8,
  },
  errorBannerText: {
    flex: 1,
    color: "#fff",
    fontSize: 14,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
  },
  avatarSection: {
    alignItems: "center",
    paddingVertical: 24,
    borderBottomWidth: 1,
    borderBottomColor: "#374151",
    marginBottom: 24,
  },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: "#10b981",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 12,
  },
  avatarText: {
    fontSize: 36,
    fontWeight: "bold",
    color: "#fffef5",
  },
  changeAvatarButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
  },
  changeAvatarText: {
    fontSize: 14,
    color: "#10b981",
    fontWeight: "600",
  },
  avatarHelp: {
    fontSize: 12,
    color: "#6b7280",
    fontStyle: "italic",
  },
  formSection: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: "#d1d5db",
    marginBottom: 8,
  },
  input: {
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    borderWidth: 1,
    borderColor: "#374151",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    color: "#fffef5",
  },
  textArea: {
    minHeight: 100,
    paddingTop: 12,
  },
  helpText: {
    fontSize: 12,
    color: "#6b7280",
    marginTop: 4,
  },
});
