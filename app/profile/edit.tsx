import { MaterialIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useAuthProfile } from "hooks/useAuthProfile";
import { useNormalizedProfile } from "hooks/useNormalizedProfile";
import { useProfile } from "hooks/useProfile";
import { getCurrentUserId } from "lib/utils/data-utils";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
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
import { useAttachmentUpload } from "../../hooks/use-attachment-upload";
import { useAuthContext } from "../../hooks/use-auth-context";
import { useBackHandler } from "../../hooks/useBackHandler";

export default function EditProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuthContext();

  // IMPORTANT: Always get the current user ID from session to prevent data leaks
  // Do NOT use a static or cached userId - it must be derived from the active session
  const currentUserId = session?.user?.id || getCurrentUserId();

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
  const [focusedField, setFocusedField] = useState<string | null>(null);

  // Avatar upload state
  const [avatarUrl, setAvatarUrl] = useState<string | null>(profile?.avatar || null);
  const [bannerUrl, setBannerUrl] = useState<string | null>(null);

  const avatarUpload = useAttachmentUpload({
    bucket: 'profiles',
    folder: 'avatars',
    allowedTypes: 'images',
    maxSizeMB: 5,
    onUploaded: (attachment) => {
      setAvatarUrl(attachment.remoteUri || attachment.uri);
    },
    onError: (error) => {
      Alert.alert('Avatar Upload Error', error.message);
    },
  });

  const bannerUpload = useAttachmentUpload({
    bucket: 'profiles',
    folder: 'banners',
    allowedTypes: 'images',
    maxSizeMB: 5,
    onUploaded: (attachment) => {
      setBannerUrl(attachment.remoteUri || attachment.uri);
    },
    onError: (error) => {
      Alert.alert('Banner Upload Error', error.message);
    },
  });

  // Clear form data when user changes to prevent data leaks
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
      setAvatarUrl(profile.avatar || null);
    }
  }, [profile, currentUserId]); // Include currentUserId to reset form when user changes

  // Check if form is dirty (has changes)
  const isDirty = React.useMemo(() => {
    const formChanged = JSON.stringify(formData) !== JSON.stringify(initialData);
    const avatarChanged = avatarUrl !== (profile?.avatar || null);
    const bannerChanged = bannerUrl !== null;
    return formChanged || avatarChanged || bannerChanged;
  }, [formData, initialData, avatarUrl, bannerUrl, profile]);

  // Handle hardware back button on Android
  useBackHandler(() => {
    if (isDirty) {
      Alert.alert(
        "Discard changes?",
        "You have unsaved changes. Are you sure you want to discard them?",
        [
          { text: "Keep Editing", style: "cancel" },
          { text: "Discard", style: "destructive", onPress: () => router.back() },
        ]
      );
      return true; // Consume the event
    }
    return false; // Let default behavior happen
  }, true);

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
      // Note: avatar_url may not be in the type definition, but is accepted by the API
      const authUpdateData: any = {
        username: formData.username,
        about: formData.bio,
      };
      if (avatarUrl) {
        authUpdateData.avatar_url = avatarUrl;
      }

      const authUpdated = await updateAuthProfile(authUpdateData);

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
        avatar: avatarUrl || undefined,
      }).catch(e => {
        console.error('[EditProfile] local profile update failed (non-critical):', e);
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
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Pinned Header: Twitter-style Cancel/Save */}
      <View style={styles.pinnedHeader}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.headerButton}
          accessibilityLabel="Cancel editing"
          accessibilityRole="button"
        >
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Edit Profile</Text>
        <TouchableOpacity
          onPress={handleSave}
          disabled={saving || !isDirty}
          style={[styles.headerButton, styles.saveButton, (!isDirty || saving) && styles.saveButtonDisabled]}
          accessibilityLabel={isDirty ? "Save profile changes" : "No changes to save"}
          accessibilityRole="button"
          accessibilityState={{ disabled: saving || !isDirty }}
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

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.keyboardAvoidingView}
        keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0}
      >
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 100 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
        {/* Banner + Avatar Overlap (Twitter-style) */}
        <View style={styles.bannerSection}>
          <TouchableOpacity
            style={styles.bannerPlaceholder}
            onPress={() => bannerUpload.pickAttachment()}
            disabled={bannerUpload.isUploading || bannerUpload.isPicking}
            accessibilityLabel="Change banner image"
            accessibilityRole="button"
          >
            {bannerUrl ? (
              <Image
                source={{ uri: bannerUrl }}
                style={{ width: '100%', height: '100%' }}
                resizeMode="cover"
              />
            ) : bannerUpload.isUploading ? (
              <>
                <ActivityIndicator size="large" color="#6b7280" />
                <Text style={styles.bannerHelpText}>
                  Uploading... {Math.round(bannerUpload.progress * 100)}%
                </Text>
              </>
            ) : (
              <>
                <MaterialIcons name="image" size={32} color="#6b7280" />
                <Text style={styles.bannerHelpText}>Tap to upload banner</Text>
              </>
            )}
          </TouchableOpacity>
          <View style={styles.avatarOverlap}>
            <TouchableOpacity
              style={styles.avatar}
              onPress={() => avatarUpload.pickAttachment()}
              disabled={avatarUpload.isUploading || avatarUpload.isPicking}
              accessibilityLabel="Change profile picture"
              accessibilityRole="button"
            >
              {avatarUrl ? (
                <Image
                  source={{ uri: avatarUrl }}
                  style={{ width: '100%', height: '100%', borderRadius: 50 }}
                  resizeMode="cover"
                />
              ) : avatarUpload.isUploading ? (
                <ActivityIndicator size="large" color="#ffffff" />
              ) : (
                <Text style={styles.avatarText}>
                  {formData.name?.[0]?.toUpperCase() || formData.username[1]?.toUpperCase() || "U"}
                </Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.avatarChangeButton}
              onPress={() => avatarUpload.pickAttachment()}
              disabled={avatarUpload.isUploading || avatarUpload.isPicking}
              accessibilityLabel="Change profile picture"
              accessibilityRole="button"
              accessibilityHint="Upload a new profile picture"
            >
              {avatarUpload.isUploading || avatarUpload.isPicking ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <MaterialIcons name="camera-alt" size={18} color="#fff" />
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* Form Fields with clear sections */}
        <View style={styles.fieldGroup}>
          <Text style={styles.sectionTitle}>Basic Information</Text>

          <View style={[styles.fieldContainer, focusedField === 'name' && styles.fieldContainerFocused]}>
            <Text style={styles.label}>Name</Text>
            <TextInput
              style={styles.input}
              value={formData.name}
              onChangeText={(text) => setFormData({ ...formData, name: text })}
              onFocus={() => setFocusedField('name')}
              onBlur={() => setFocusedField(null)}
              placeholder="Your display name"
              placeholderTextColor="#6b7280"
              accessibilityLabel="Display name"
              accessibilityHint="Enter your display name"
            />
          </View>

          <View style={[styles.fieldContainer, focusedField === 'username' && styles.fieldContainerFocused]}>
            <Text style={styles.label}>Username</Text>
            <TextInput
              style={styles.input}
              value={formData.username}
              onChangeText={(text) => setFormData({ ...formData, username: text })}
              onFocus={() => setFocusedField('username')}
              onBlur={() => setFocusedField(null)}
              placeholder="@username"
              placeholderTextColor="#6b7280"
              autoCapitalize="none"
              accessibilityLabel="Username"
              accessibilityHint="Enter your unique username"
            />
          </View>

          <View style={[styles.fieldContainer, focusedField === 'bio' && styles.fieldContainerFocused]}>
            <Text style={styles.label}>Bio</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={formData.bio}
              onChangeText={(text) => setFormData({ ...formData, bio: text.slice(0, maxBioLength) })}
              onFocus={() => setFocusedField('bio')}
              onBlur={() => setFocusedField(null)}
              placeholder="Tell others about yourself..."
              placeholderTextColor="#6b7280"
              multiline
              numberOfLines={4}
              maxLength={maxBioLength}
              textAlignVertical="top"
              accessibilityLabel="Bio"
              accessibilityHint={`Enter your bio, ${bioLength} of ${maxBioLength} characters used`}
            />
            <Text style={styles.characterCounter}>
              {bioLength}/{maxBioLength}
            </Text>
          </View>
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.sectionTitle}>Location & Links</Text>

          <View style={[styles.fieldContainer, focusedField === 'location' && styles.fieldContainerFocused]}>
            <Text style={styles.label}>Location</Text>
            <TextInput
              style={styles.input}
              value={formData.location}
              onChangeText={(text) => setFormData({ ...formData, location: text })}
              onFocus={() => setFocusedField('location')}
              onBlur={() => setFocusedField(null)}
              placeholder="City, Country"
              placeholderTextColor="#6b7280"
              accessibilityLabel="Location"
              accessibilityHint="Enter your city and country"
            />
          </View>

          <View style={[styles.fieldContainer, focusedField === 'portfolio' && styles.fieldContainerFocused]}>
            <Text style={styles.label}>Website / Portfolio</Text>
            <TextInput
              style={styles.input}
              value={formData.portfolio}
              onChangeText={(text) => setFormData({ ...formData, portfolio: text })}
              onFocus={() => setFocusedField('portfolio')}
              onBlur={() => setFocusedField(null)}
              placeholder="https://yourwebsite.com"
              placeholderTextColor="#6b7280"
              keyboardType="url"
              autoCapitalize="none"
              accessibilityLabel="Website or Portfolio URL"
              accessibilityHint="Enter your website or portfolio link"
            />
          </View>
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.sectionTitle}>Skills & Expertise</Text>

          <View style={[styles.fieldContainer, focusedField === 'skillsets' && styles.fieldContainerFocused]}>
            <Text style={styles.label}>Skillsets</Text>
            <TextInput
              style={styles.input}
              value={formData.skillsets}
              onChangeText={(text) => setFormData({ ...formData, skillsets: text })}
              onFocus={() => setFocusedField('skillsets')}
              onBlur={() => setFocusedField(null)}
              placeholder="e.g., React, Node.js, Design"
              placeholderTextColor="#6b7280"
              accessibilityLabel="Skillsets"
              accessibilityHint="Enter your skills separated by commas"
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
    </View>
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
    paddingVertical: 8,
    minHeight: 44, // Ensure minimum touch target height
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
  keyboardAvoidingView: {
    flex: 1,
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
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  bannerPlaceholder: {
    height: 140,
    backgroundColor: "#047857",
    justifyContent: "center",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255, 255, 255, 0.1)",
  },
  bannerHelpText: {
    fontSize: 13,
    color: "#d1fae5",
    marginTop: 6,
    fontStyle: "italic",
    fontWeight: "500",
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
    borderWidth: 5,
    borderColor: "#064e3b",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 8,
  },
  avatarText: {
    fontSize: 40,
    fontWeight: "bold",
    color: "#ffffff",
  },
  avatarChangeButton: {
    position: "absolute",
    bottom: -4,
    right: -4,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#10b981",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 4,
    borderColor: "#064e3b",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3,
    elevation: 5,
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
    paddingVertical: 14,
    marginBottom: 1,
    borderLeftWidth: 3,
    borderLeftColor: "transparent",
  },
  fieldContainerFocused: {
    backgroundColor: "rgba(16, 185, 129, 0.12)",
    borderLeftColor: "#10b981",
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
    paddingVertical: 6,
    fontSize: 16,
    color: "#ffffff",
    lineHeight: 22,
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
