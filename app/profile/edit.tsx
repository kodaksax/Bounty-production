import { MaterialIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useNormalizedProfile } from "hooks/useNormalizedProfile";
import { useProfile } from "hooks/useProfile";
import { useAuthProfile } from "hooks/useAuthProfile";
import { getCurrentUserId } from "lib/utils/data-utils";
import React, { useState } from "react";
import {
    ActivityIndicator,
    Alert,
    KeyboardAvoidingView,
    Platform,
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
  
  // Use normalized profile for display and both services for update operations
  const { profile, loading, error } = useNormalizedProfile(currentUserId);
  const { updateProfile: updateLocalProfile } = useProfile(currentUserId);
  const { updateProfile: updateAuthProfile } = useAuthProfile();

  const [formData, setFormData] = useState({
    name: profile?.name || "",
    username: profile?.username || "",
    bio: profile?.bio || "",
    location: profile?.location || "",
    portfolio: profile?.portfolio || "",
    skillsets: profile?.skills?.join(", ") || "",
  });

  const [initialData, setInitialData] = useState(formData);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dismissedError, setDismissedError] = useState(false);

  React.useEffect(() => {
    if (profile) {
      const data = {
        name: profile.name || "",
        username: profile.username || "",
        bio: profile.bio || "",
        location: profile.location || "",
        portfolio: profile.portfolio || "",
        skillsets: profile.skills?.join(", ") || "",
      };
      setFormData(data);
      setInitialData(data);
    }
  }, [profile]);

  // Check if form is dirty (has changes)
  const isDirty = React.useMemo(() => {
    return JSON.stringify(formData) !== JSON.stringify(initialData);
  }, [formData, initialData]);

  const handleSave = async () => {
    try {
      setSaving(true);
      setSaveError(null);
      setDismissedError(false);

      // Parse comma-separated skillsets
      const skillsets = formData.skillsets
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      // Update auth profile (primary source of truth)
      const authUpdated = await updateAuthProfile({
        username: formData.username,
        about: formData.bio,
      });
      
      if (!authUpdated) {
        throw new Error("Failed to update profile");
      }

      // Also update local profile for backward compatibility
      await updateLocalProfile({
        name: formData.name,
        username: formData.username,
        bio: formData.bio,
        location: formData.location,
        portfolio: formData.portfolio,
        skills: skillsets,
      }).catch(e => {
        console.warn('[EditProfile] local profile update failed (non-critical):', e);
      });

      // Update initial data after successful save
      setInitialData(formData);

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
  const bioLength = formData.bio.length;
  const maxBioLength = 160;

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={[styles.container, { paddingTop: insets.top }]}
    >
      {/* Pinned Header: Twitter-style Cancel/Save */}
      <View style={styles.pinnedHeader}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerButton}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Edit Profile</Text>
        <TouchableOpacity
          onPress={handleSave}
          disabled={saving || !isDirty}
          style={[styles.headerButton, styles.saveButton, (!isDirty || saving) && styles.saveButtonDisabled]}
        >
          {saving ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={[styles.saveText, !isDirty && styles.saveTextDisabled]}>Save</Text>
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
        keyboardShouldPersistTaps="handled"
      >
        {/* Banner + Avatar Overlap (Twitter-style) */}
        <View style={styles.bannerSection}>
          <View style={styles.bannerPlaceholder}>
            <MaterialIcons name="image" size={32} color="#6b7280" />
            <Text style={styles.bannerHelpText}>Banner upload coming soon</Text>
          </View>
          <View style={styles.avatarOverlap}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {formData.name?.[0]?.toUpperCase() || formData.username[1]?.toUpperCase() || "U"}
              </Text>
            </View>
            <TouchableOpacity style={styles.avatarChangeButton}>
              <MaterialIcons name="camera-alt" size={18} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Form Fields with clear sections */}
        <View style={styles.fieldGroup}>
          <Text style={styles.sectionTitle}>Basic Information</Text>
          
          <View style={styles.fieldContainer}>
            <Text style={styles.label}>Name</Text>
            <TextInput
              style={styles.input}
              value={formData.name}
              onChangeText={(text) => setFormData({ ...formData, name: text })}
              placeholder="Your display name"
              placeholderTextColor="#6b7280"
            />
          </View>

          <View style={styles.fieldContainer}>
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

          <View style={styles.fieldContainer}>
            <Text style={styles.label}>Bio</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={formData.bio}
              onChangeText={(text) => setFormData({ ...formData, bio: text.slice(0, maxBioLength) })}
              placeholder="Tell others about yourself..."
              placeholderTextColor="#6b7280"
              multiline
              numberOfLines={4}
              maxLength={maxBioLength}
              textAlignVertical="top"
            />
            <Text style={styles.characterCounter}>
              {bioLength}/{maxBioLength}
            </Text>
          </View>
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.sectionTitle}>Location & Links</Text>
          
          <View style={styles.fieldContainer}>
            <Text style={styles.label}>Location</Text>
            <TextInput
              style={styles.input}
              value={formData.location}
              onChangeText={(text) => setFormData({ ...formData, location: text })}
              placeholder="City, Country"
              placeholderTextColor="#6b7280"
            />
          </View>

          <View style={styles.fieldContainer}>
            <Text style={styles.label}>Website / Portfolio</Text>
            <TextInput
              style={styles.input}
              value={formData.portfolio}
              onChangeText={(text) => setFormData({ ...formData, portfolio: text })}
              placeholder="https://yourwebsite.com"
              placeholderTextColor="#6b7280"
              keyboardType="url"
              autoCapitalize="none"
            />
          </View>
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.sectionTitle}>Skills & Expertise</Text>
          
          <View style={styles.fieldContainer}>
            <Text style={styles.label}>Skillsets</Text>
            <TextInput
              style={styles.input}
              value={formData.skillsets}
              onChangeText={(text) => setFormData({ ...formData, skillsets: text })}
              placeholder="e.g., React, Node.js, Design"
              placeholderTextColor="#6b7280"
            />
            <Text style={styles.helpText}>Separate with commas. Max 4 skills recommended.</Text>
          </View>
        </View>

        <View style={styles.infoBox}>
          <MaterialIcons name="info-outline" size={16} color="#6ee7b7" />
          <Text style={styles.infoText}>
            Badges and Achievements are earned automatically and cannot be edited here.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#064e3b", // emerald-900
  },
  pinnedHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: "#047857", // emerald-700
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255, 255, 255, 0.1)",
  },
  headerButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: "700",
    color: "#ffffff",
    textAlign: "center",
  },
  cancelText: {
    fontSize: 16,
    color: "#ffffff",
    fontWeight: "500",
  },
  saveButton: {
    backgroundColor: "#10b981", // emerald-500
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 6,
    minWidth: 60,
    alignItems: "center",
  },
  saveButtonDisabled: {
    backgroundColor: "#6b7280",
    opacity: 0.5,
  },
  saveText: {
    fontSize: 16,
    color: "#ffffff",
    fontWeight: "600",
  },
  saveTextDisabled: {
    opacity: 0.6,
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
    paddingTop: 0,
  },
  bannerSection: {
    position: "relative",
    marginBottom: 60,
  },
  bannerPlaceholder: {
    height: 120,
    backgroundColor: "#047857",
    justifyContent: "center",
    alignItems: "center",
  },
  bannerHelpText: {
    fontSize: 12,
    color: "#d1fae5",
    marginTop: 4,
    fontStyle: "italic",
  },
  avatarOverlap: {
    position: "absolute",
    bottom: -50,
    left: 16,
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: "#10b981",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 4,
    borderColor: "#064e3b",
  },
  avatarText: {
    fontSize: 40,
    fontWeight: "bold",
    color: "#ffffff",
  },
  avatarChangeButton: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#047857",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: "#064e3b",
  },
  fieldGroup: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#a7f3d0",
    marginBottom: 16,
    paddingHorizontal: 16,
  },
  fieldContainer: {
    backgroundColor: "rgba(16, 185, 129, 0.08)",
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 1,
  },
  label: {
    fontSize: 12,
    fontWeight: "600",
    color: "#6ee7b7",
    marginBottom: 6,
  },
  input: {
    backgroundColor: "transparent",
    borderWidth: 0,
    paddingHorizontal: 0,
    paddingVertical: 4,
    fontSize: 16,
    color: "#ffffff",
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: "top",
  },
  characterCounter: {
    fontSize: 11,
    color: "#6b7280",
    textAlign: "right",
    marginTop: 4,
  },
  helpText: {
    fontSize: 11,
    color: "#6ee7b7",
    marginTop: 4,
    fontStyle: "italic",
  },
  infoBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: "rgba(16, 185, 129, 0.12)",
    padding: 12,
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 24,
    borderRadius: 8,
    gap: 8,
  },
  infoText: {
    flex: 1,
    fontSize: 12,
    color: "#d1fae5",
    lineHeight: 16,
  },
});
