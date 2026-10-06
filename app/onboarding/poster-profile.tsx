/**
 * Onboarding Poster Profile
 * The poster branch's last asking step: right after role select
 * (app/onboarding/role-select.tsx, "Make today pay.") and before the founder
 * note (app/onboarding/founder-note.tsx), which closes the flow. It holds the
 * same slot in the progress dots that payouts holds for hunters, so both
 * branches stay ONBOARDING_TOTAL_STEPS long.
 *
 * Hunters see a poster's name, photo and bio before taking the bounty, so
 * this is the moment to set them. The card at the top is a live preview of
 * how the profile reads to a hunter.
 *
 * Nothing here is written to the profile directly. Continue commits name,
 * bio and avatar to the onboarding draft and useCompleteOnboarding writes
 * them on the founder note. The photo is uploaded as soon as it is picked,
 * because completion only writes a remote avatar URL, never a file:// one.
 * Skip commits nothing, so a half-typed name doesn't land on the profile.
 */

import { MaterialIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ONBOARDING_TOTAL_STEPS,
  OnboardingProgressDots,
} from '../../components/onboarding/OnboardingProgressDots';
import { useOnboarding } from '../../lib/context/onboarding-context';
import { hapticFeedback } from '../../lib/haptic-feedback';
import { analyticsService } from '../../lib/services/analytics-service';
import { avatarService } from '../../lib/services/avatar-service';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import { palette } from '../../lib/themes/colors';
import type { AppTheme } from '../../lib/themes/types';

const NEXT_STEP = '/onboarding/founder-note' as const;
export const POSTER_BIO_MAX_LENGTH = 160;
const NAME_MAX_LENGTH = 50;
const AVATAR_SIZE = 56;

export default function PosterProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme } = useAppThemeContext();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const { data: onboardingData, updateData } = useOnboarding();

  // Seeded from the draft so coming back to this step keeps what was entered.
  const [name, setName] = useState(onboardingData.displayName);
  const [bio, setBio] = useState(onboardingData.bio);
  // Remote URL once uploaded. A file:// draft value from an older build is
  // dropped: completion would ignore it anyway.
  const [avatarUrl, setAvatarUrl] = useState(
    onboardingData.avatarUri.startsWith('file://') ? '' : onboardingData.avatarUri
  );
  // Local preview shown while the upload is in flight.
  const [pendingAvatarUri, setPendingAvatarUri] = useState<string | null>(null);
  const uploading = pendingAvatarUri !== null;
  // Blocks a second Continue tap from pushing the founder note twice during
  // the transition; cleared when this step regains focus.
  const advancingRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      advancingRef.current = false;
    }, [])
  );

  useEffect(() => {
    analyticsService.trackEvent('onboarding_poster_profile_viewed', {});
  }, []);

  const trimmedName = name.trim();
  const trimmedBio = bio.trim();
  const hasInput = trimmedName.length > 0 || trimmedBio.length > 0 || avatarUrl.length > 0;
  const canContinue = hasInput && !uploading;

  const pickAvatar = async () => {
    if (uploading) return;
    hapticFeedback.light();
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Photo access needed', 'Allow photo access in Settings to add a profile photo.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });
      if (result.canceled || !result.assets?.length) return;

      const asset = result.assets[0];
      setPendingAvatarUri(asset.uri);
      const { avatarUrl: uploadedUrl, error } = await avatarService.uploadAvatar(asset.uri, {
        fileName: asset.fileName || 'avatar.jpg',
        mimeType: asset.mimeType,
        size: asset.fileSize,
      });
      if (error || !uploadedUrl) {
        throw error ?? new Error('Upload failed');
      }
      setAvatarUrl(uploadedUrl);
      analyticsService.trackEvent('onboarding_poster_avatar_uploaded', {});
    } catch (error) {
      console.error('[Onboarding] poster avatar upload failed:', error);
      Alert.alert(
        "Couldn't upload photo",
        error instanceof Error && error.message ? error.message : 'Please try again.'
      );
    } finally {
      setPendingAvatarUri(null);
    }
  };

  const handleContinue = () => {
    if (!canContinue || advancingRef.current) return;
    advancingRef.current = true;
    hapticFeedback.light();
    updateData({ displayName: trimmedName, bio: trimmedBio, avatarUri: avatarUrl });
    analyticsService.trackEvent('onboarding_poster_profile_saved', {
      hasName: trimmedName.length > 0,
      hasBio: trimmedBio.length > 0,
      hasAvatar: avatarUrl.length > 0,
    });
    router.push(NEXT_STEP);
  };

  const handleSkip = () => {
    if (uploading) return;
    hapticFeedback.light();
    analyticsService.trackEvent('onboarding_step_skipped', { step: 'poster_profile' });
    router.push(NEXT_STEP);
  };

  const handleBack = () => {
    hapticFeedback.light();
    router.back();
  };

  const previewImage = pendingAvatarUri ?? (avatarUrl || null);
  const badgeLine = onboardingData.location
    ? `New poster · ${onboardingData.location}`
    : 'New poster';

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.backRow}>
          {router.canGoBack() && (
            <TouchableOpacity
              onPress={handleBack}
              style={styles.backButton}
              accessibilityRole="button"
              accessibilityLabel="Go back"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <MaterialIcons name="arrow-back" size={24} color={theme.textSecondary} />
            </TouchableOpacity>
          )}
        </View>

        <OnboardingProgressDots
          total={ONBOARDING_TOTAL_STEPS}
          activeIndex={4}
          style={styles.dotsContainer}
        />

        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.heading} accessibilityRole="header">
            Build your profile
          </Text>
          <Text style={styles.subheading}>Hunters see this before they take your bounty.</Text>

          <View style={styles.previewCard}>
            <View style={styles.previewRow}>
              <TouchableOpacity
                onPress={pickAvatar}
                disabled={uploading}
                style={styles.avatarButton}
                accessibilityRole="button"
                accessibilityLabel={previewImage ? 'Change profile photo' : 'Add profile photo'}
                accessibilityState={{ busy: uploading }}
              >
                {previewImage ? (
                  <Image source={{ uri: previewImage }} style={styles.avatarImage} />
                ) : (
                  <MaterialIcons name="add-a-photo" size={22} color={theme.textSecondary} />
                )}
                {uploading && (
                  <View style={styles.avatarBusy}>
                    <ActivityIndicator color={palette.white} />
                  </View>
                )}
                <View style={styles.cameraBadge}>
                  <MaterialIcons name="photo-camera" size={12} color={palette.white} />
                </View>
              </TouchableOpacity>
              <View style={styles.previewText}>
                <Text
                  style={[styles.previewName, !trimmedName && styles.previewPlaceholder]}
                  numberOfLines={1}
                >
                  {trimmedName || 'Your name'}
                </Text>
                <Text style={styles.previewBadge} numberOfLines={1}>
                  {badgeLine}
                </Text>
              </View>
            </View>
            <Text
              style={[styles.previewBio, !trimmedBio && styles.previewPlaceholder]}
              numberOfLines={3}
            >
              {trimmedBio || 'A line or two about you shows here.'}
            </Text>
          </View>

          <Text style={styles.label}>Name</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="How you'll appear to others"
            placeholderTextColor={theme.textDisabled}
            style={styles.input}
            maxLength={NAME_MAX_LENGTH}
            autoCapitalize="words"
            autoComplete="name"
            textContentType="name"
            returnKeyType="next"
            accessibilityLabel="Name"
          />

          <View style={styles.labelRow}>
            <Text style={styles.label}>Short bio</Text>
            <Text style={styles.counter}>
              {bio.length}/{POSTER_BIO_MAX_LENGTH}
            </Text>
          </View>
          <TextInput
            value={bio}
            onChangeText={setBio}
            placeholder="What should people know before they work with you?"
            placeholderTextColor={theme.textDisabled}
            style={[styles.input, styles.bioInput]}
            maxLength={POSTER_BIO_MAX_LENGTH}
            multiline
            textAlignVertical="top"
            accessibilityLabel="Short bio"
          />
        </ScrollView>

        <View style={styles.actionContainer}>
          <TouchableOpacity
            style={[styles.primaryButton, !canContinue && styles.buttonDisabled]}
            onPress={handleContinue}
            disabled={!canContinue}
            accessibilityRole="button"
            accessibilityLabel="Continue"
            accessibilityState={{ disabled: !canContinue }}
          >
            <Text style={styles.primaryButtonText}>Continue</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.skipLink}
            onPress={handleSkip}
            disabled={uploading}
            accessibilityRole="button"
            accessibilityLabel="Skip for now"
          >
            <Text style={styles.skipLinkText}>Skip for now</Text>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
    flex: {
      flex: 1,
    },
    container: {
      flex: 1,
      backgroundColor: theme.background,
      paddingHorizontal: 24,
    },
    backRow: {
      paddingTop: 8,
      flexDirection: 'row',
      minHeight: 48,
    },
    backButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.surface,
    },
    dotsContainer: {
      paddingTop: 8,
    },
    scrollContent: {
      paddingTop: 24,
      paddingBottom: 16,
    },
    heading: {
      fontSize: 28,
      lineHeight: 34,
      fontWeight: '700',
      color: theme.text,
      letterSpacing: -0.5,
    },
    subheading: {
      fontSize: 15,
      lineHeight: 22,
      color: theme.textSecondary,
      marginTop: 8,
    },
    previewCard: {
      marginTop: 24,
      padding: 16,
      borderRadius: theme.radius.xl,
      borderWidth: 1,
      borderColor: `${theme.primary}40`,
      backgroundColor: theme.surface,
    },
    previewRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    avatarButton: {
      width: AVATAR_SIZE,
      height: AVATAR_SIZE,
      borderRadius: AVATAR_SIZE / 2,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: theme.border,
      backgroundColor: theme.surfaceSecondary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarImage: {
      width: AVATAR_SIZE,
      height: AVATAR_SIZE,
      borderRadius: AVATAR_SIZE / 2,
    },
    avatarBusy: {
      ...StyleSheet.absoluteFillObject,
      borderRadius: AVATAR_SIZE / 2,
      backgroundColor: theme.overlay,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cameraBadge: {
      position: 'absolute',
      right: -4,
      bottom: -4,
      width: 22,
      height: 22,
      borderRadius: 6,
      backgroundColor: theme.primary,
      borderWidth: 2,
      borderColor: theme.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    previewText: {
      flex: 1,
    },
    previewName: {
      fontSize: 17,
      fontWeight: '700',
      color: theme.text,
    },
    previewBadge: {
      fontSize: 13,
      color: theme.textSecondary,
      marginTop: 2,
    },
    previewBio: {
      fontSize: 14,
      lineHeight: 20,
      color: theme.text,
      marginTop: 14,
    },
    previewPlaceholder: {
      color: theme.textDisabled,
    },
    labelRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'baseline',
    },
    label: {
      fontSize: 13,
      fontWeight: '600',
      color: theme.textSecondary,
      marginTop: 20,
      marginBottom: 8,
    },
    counter: {
      fontSize: 12,
      color: theme.textDisabled,
    },
    input: {
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: theme.radius.lg,
      backgroundColor: theme.surface,
      color: theme.text,
      fontSize: 16,
      paddingHorizontal: 14,
      paddingVertical: 14,
    },
    bioInput: {
      minHeight: 72,
    },
    actionContainer: {
      paddingTop: 8,
      paddingBottom: 12,
    },
    primaryButton: {
      backgroundColor: theme.primary,
      paddingVertical: 16,
      borderRadius: 999,
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 56,
    },
    buttonDisabled: {
      opacity: 0.5,
    },
    primaryButtonText: {
      color: palette.white,
      fontSize: 18,
      fontWeight: 'bold',
    },
    skipLink: {
      marginTop: 8,
      paddingVertical: 10,
      alignItems: 'center',
    },
    skipLinkText: {
      color: theme.textSecondary,
      fontSize: 14,
      fontWeight: '500',
    },
  });
}
