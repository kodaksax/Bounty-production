import { MaterialIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useAuthProfile } from "hooks/useAuthProfile";
import { useNormalizedProfile } from "hooks/useNormalizedProfile";
import { useProfile } from "hooks/useProfile";
import { AuthProfile } from "lib/services/auth-profile-service";
import { getCurrentUserId } from "lib/utils/data-utils";
import React, { useRef, useState } from "react";
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

type EditProfileFormData = {
  name: string;
  username: string;
  bio: string;
  location: string;
  portfolio: string;
  skillsets: string;
};

const EMPTY_FORM_DATA: EditProfileFormData = {
  name: "",
  username: "",
  bio: "",
  location: "",
  portfolio: "",
  skillsets: "",
};

const isSameFormData = (a: EditProfileFormData, b: EditProfileFormData): boolean => (
  a.name === b.name &&
  a.username === b.username &&
  a.bio === b.bio &&
  a.location === b.location &&
  a.portfolio === b.portfolio &&
  a.skillsets === b.skillsets
);

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

  // Initialize state with empty values - will be populated by useEffect when profile loads
  const [formData, setFormData] = useState<EditProfileFormData>(EMPTY_FORM_DATA);

  const [initialData, setInitialData] = useState<EditProfileFormData>(EMPTY_FORM_DATA);
  // Keep a ref of the last applied initial data so we can detect local edits
  const initialRef = React.useRef<EditProfileFormData>(EMPTY_FORM_DATA);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dismissedError, setDismissedError] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);

  const usernameRef = useRef<TextInput>(null);
  const bioRef = useRef<TextInput>(null);
  const locationRef = useRef<TextInput>(null);
  const portfolioRef = useRef<TextInput>(null);
  const skillsetsRef = useRef<TextInput>(null);
  // Track whether the user has made manual edits to the form to avoid
  // overwriting their changes when the profile object reference changes
  // (e.g., normalized payloads that merge but produce new references).
  const userEditedRef = useRef<boolean>(false);
  // Track last seen user id so we can reset form when switching users
  const lastUserIdRef = useRef<string | undefined>(currentUserId);

  // Avatar upload state
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  // TODO: Banner functionality - backend support needed (database schema doesn't include banner field yet)
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
      // Note: Banner will be uploaded but not saved to profile (backend support needed)
      Alert.alert(
        'Banner Uploaded',
        'Your banner has been uploaded but will not be saved yet. Banner support is coming soon!',
        [{ text: 'OK' }]
      );
    },
    onError: (error) => {
      Alert.alert('Banner Upload Error', error.message);
    },
  });

  const normalizedSkillsets = React.useMemo(
    () => (Array.isArray(profile?.skills) ? profile.skills.join(", ") : ""),
    [profile?.skills]
  );

  const profileFormData = React.useMemo<EditProfileFormData | null>(() => {
    if (!profile) return null;
    return {
      name: profile.name || "",
      username: profile.username || "",
      bio: profile.bio || "",
      location: profile.location || "",
      portfolio: profile.portfolio || "",
      skillsets: normalizedSkillsets,
    };
  }, [profile, normalizedSkillsets]);

  // Keep local edit state in sync with profile snapshots without re-running on
  // every render. This prevents maximum update depth errors caused by
  // repeatedly setting local state from equivalent profile payloads.
  React.useEffect(() => {
    const nextData = profileFormData ?? EMPTY_FORM_DATA;

    // Use a functional update so we don't read `formData` from outer scope,
    // which can cause a circular update when the effect also writes state.
    setFormData((prev) => {
      const hasLocalEdits = !isSameFormData(prev, initialRef.current);
      if (hasLocalEdits) return prev;
      return isSameFormData(prev, nextData) ? prev : nextData;
    });

    // Update the recorded initial snapshot only when the incoming profile
    // snapshot actually differs from what we had before.
    if (!isSameFormData(initialRef.current, nextData)) {
      initialRef.current = nextData;
      setInitialData(nextData);
    }

    // If the incoming profile equals our recorded initial data, do nothing.
    if (isSameFormData(initialData, nextData)) {
      // Update avatar if it changed independently
      const nextAvatar = profile?.avatar || null;
      setAvatarUrl((prev) => (prev === nextAvatar ? prev : nextAvatar));
      return;
    }

    // If the user hasn't modified the form (formData matches initialData),
    // adopt the new profile snapshot into both formData and initialData.
    if (isSameFormData(formData, initialData)) {
      setFormData(nextData);
      setInitialData(nextData);
    }

    // Update avatar if changed and user hasn't manually changed it
    const nextAvatar = profile?.avatar || null;

    const userChanged = lastUserIdRef.current !== currentUserId;

    if (userChanged) {
      // New user: reset edited flag and replace form/initial state with new user's data
      userEditedRef.current = false;
      setFormData(nextData);
      setInitialData(nextData);
      setAvatarUrl(nextAvatar);
      lastUserIdRef.current = currentUserId;
      return;
    }

    // Same user: only sync from profile if the user hasn't edited locally
    setFormData((prev) => (userEditedRef.current || isSameFormData(prev, nextData) ? prev : nextData));
    setInitialData((prev) => (userEditedRef.current || isSameFormData(prev, nextData) ? prev : nextData));
    setAvatarUrl((prev) => (prev === nextAvatar ? prev : nextAvatar));
  }, [profileFormData, profile?.avatar, currentUserId]);

  // Check if form is dirty (has changes)
  const isDirty = React.useMemo(() => {
    const formChanged = JSON.stringify(formData) !== JSON.stringify(initialData);
    const avatarChanged = avatarUrl !== (profile?.avatar || null);
    const bannerChanged = bannerUrl !== null;
    return formChanged || avatarChanged || bannerChanged;
  }, [formData, initialData, avatarUrl, bannerUrl, profile]);

  // Handle back/cancel with unsaved changes check
  const handleCancel = React.useCallback(() => {
    if (isDirty) {
      Alert.alert(
        "Discard changes?",
        "You have unsaved changes. Are you sure you want to discard them?",
        [
          { text: "Keep Editing", style: "cancel" },
          {
            text: "Discard",
            style: "destructive",
            onPress: () => {
              // Reset form data to initial state
              setFormData(initialData);
              setAvatarUrl(profile?.avatar || null);
              setBannerUrl(null);
                // Mark as not edited after discarding changes
                userEditedRef.current = false;
              router.back();
            }
          },
        ]
      );
    } else {
      router.back();
    }
  }, [isDirty, initialData, profile, router]);

  // Handle hardware back button on Android
  useBackHandler(() => {
    if (isDirty) {
      Alert.alert(
        "Discard changes?",
        "You have unsaved changes. Are you sure you want to discard them?",
        [
          { text: "Keep Editing", style: "cancel" },
              { text: "Discard", style: "destructive", onPress: () => { userEditedRef.current = false; router.back(); } },
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
      const authUpdateData: Partial<Omit<AuthProfile, 'id' | 'created_at'>> = {
        username: formData.username,
        about: formData.bio,
      };
      if (avatarUrl) {
        authUpdateData.avatar = avatarUrl;
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
      // Clear edited flag after successful save
      userEditedRef.current = false;

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
          onPress={handleCancel}
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
                accessibilityLabel="Current profile picture"
                accessibilityRole="imagebutton"
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
                onChangeText={(text) => setFormData((prev) => { userEditedRef.current = true; return { ...prev, name: text }; })}
                onFocus={() => setFocusedField('name')}
                onBlur={() => setFocusedField(null)}
                placeholder="Your display name"
                placeholderTextColor="#6b7280"
                accessibilityLabel="Display name"
                accessibilityHint="Enter your display name"
                returnKeyType="next"
                blurOnSubmit={false}
                onSubmitEditing={() => usernameRef.current?.focus()}
              />
            </View>

            <View style={[styles.fieldContainer, focusedField === 'username' && styles.fieldContainerFocused]}>
              <Text style={styles.label}>Username</Text>
              <TextInput
                ref={usernameRef}
                style={styles.input}
                value={formData.username}
                onChangeText={(text) => setFormData((prev) => { userEditedRef.current = true; return { ...prev, username: text }; })}
                onFocus={() => setFocusedField('username')}
                onBlur={() => setFocusedField(null)}
                placeholder="@username"
                placeholderTextColor="#6b7280"
                autoCapitalize="none"
                accessibilityLabel="Username"
                accessibilityHint="Enter your unique username"
                returnKeyType="next"
                blurOnSubmit={false}
                onSubmitEditing={() => bioRef.current?.focus()}
              />
            </View>

            <View style={[styles.fieldContainer, focusedField === 'bio' && styles.fieldContainerFocused]}>
              <Text style={styles.label}>Bio</Text>
              <TextInput
                ref={bioRef}
                style={[styles.input, styles.textArea]}
                value={formData.bio}
                onChangeText={(text) => setFormData((prev) => { userEditedRef.current = true; return { ...prev, bio: text.slice(0, maxBioLength) }; })}
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
                returnKeyType="next"
                blurOnSubmit={false}
                onSubmitEditing={() => locationRef.current?.focus()}
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
                ref={locationRef}
                style={styles.input}
                value={formData.location}
                onChangeText={(text) => setFormData((prev) => { userEditedRef.current = true; return { ...prev, location: text }; })}
                onFocus={() => setFocusedField('location')}
                onBlur={() => setFocusedField(null)}
                placeholder="City, Country"
                placeholderTextColor="#6b7280"
                accessibilityLabel="Location"
                accessibilityHint="Enter your city and country"
                returnKeyType="next"
                blurOnSubmit={false}
                onSubmitEditing={() => portfolioRef.current?.focus()}
              />
            </View>

            <View style={[styles.fieldContainer, focusedField === 'portfolio' && styles.fieldContainerFocused]}>
              <Text style={styles.label}>Website / Portfolio</Text>
              <TextInput
                ref={portfolioRef}
                style={styles.input}
                value={formData.portfolio}
                onChangeText={(text) => setFormData((prev) => { userEditedRef.current = true; return { ...prev, portfolio: text }; })}
                onFocus={() => setFocusedField('portfolio')}
                onBlur={() => setFocusedField(null)}
                placeholder="https://yourwebsite.com"
                placeholderTextColor="#6b7280"
                keyboardType="url"
                autoCapitalize="none"
                accessibilityLabel="Website or Portfolio URL"
                accessibilityHint="Enter your website or portfolio link"
                returnKeyType="next"
                blurOnSubmit={false}
                onSubmitEditing={() => skillsetsRef.current?.focus()}
              />
            </View>
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.sectionTitle}>Skills & Expertise</Text>

            <View style={[styles.fieldContainer, focusedField === 'skillsets' && styles.fieldContainerFocused]}>
              <Text style={styles.label}>Skillsets</Text>
              <TextInput
                ref={skillsetsRef}
                style={styles.input}
                value={formData.skillsets}
                onChangeText={(text) => setFormData((prev) => { userEditedRef.current = true; return { ...prev, skillsets: text }; })}
                onFocus={() => setFocusedField('skillsets')}
                onBlur={() => setFocusedField(null)}
                placeholder="e.g., React, Node.js, Design"
                placeholderTextColor="#6b7280"
                accessibilityLabel="Skillsets"
                accessibilityHint="Enter your skills separated by commas"
                returnKeyType="done"
                onSubmitEditing={handleSave}
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

// Banner configuration
const BANNER_HEIGHT = 140; // Increased from 120px for better visual presence

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
    height: BANNER_HEIGHT,
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
    paddingVertical: 14, // Increased for better mobile touch targets (44x44 minimum)
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
