/**
 * Details Onboarding Screen
 * Second step: collect optional display name, avatar, location, title, bio, skills
 * Features: State persistence, profile picture prominence, branding
 */

import { MaterialIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
    ActionSheetIOS,
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
import { AddMoneyScreen } from '../../components/add-money-screen';
import { BrandingLogo } from '../../components/ui/branding-logo';
import { useAuthContext } from '../../hooks/use-auth-context';
import { useAuthProfile } from '../../hooks/useAuthProfile';
import { useNormalizedProfile } from '../../hooks/useNormalizedProfile';
import { useUserProfile } from '../../hooks/useUserProfile';
import { useOnboarding } from '../../lib/context/onboarding-context';
import { attachmentService } from '../../lib/services/attachment-service';
import { authProfileService } from '../../lib/services/auth-profile-service';
import { bountyService } from '../../lib/services/bounty-service';
import { bountyRequestService } from '../../lib/services/bounty-request-service';
import { Bounty, Profile } from '../../lib/services/database.types';
import { locationService } from '../../lib/services/location-service';
import { getOnboardingCompleteKey } from '../../lib/storage/onboarding';
import { supabase } from '../../lib/supabase';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';
import { bountyService as bountyCreationService } from '../services/bountyService';
import { validateAmount, validateDescription, validateTitle } from '../../lib/utils/bounty-validation';

const COMMON_SKILLS = [
  'Handyman', 'Cleaning', 'Moving', 'Delivery', 'Pet Care',
  'Gardening', 'Photography', 'Tutoring', 'Tech Support', 'Design',
];

export default function DetailsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { profile: localProfile, updateProfile } = useUserProfile();
  const { userId, updateProfile: updateAuthProfile } = useAuthProfile();
  const { session } = useAuthContext();
  const { profile: normalized } = useNormalizedProfile();
  const { data: onboardingData, updateData: updateOnboardingData } = useOnboarding();
  const { theme } = useAppThemeContext();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  // Initialize from context, then fallback to profile data
  const [displayName, setDisplayName] = useState<string>(
    onboardingData.displayName || (normalized as any)?.name || (localProfile as any)?.displayName || ''
  );
  const [title, setTitle] = useState<string>(
    onboardingData.title || ((normalized as any)?._raw && (normalized as any)._raw.title) || (localProfile as any)?.title || ''
  );
  const [bio, setBio] = useState<string>(
    onboardingData.bio || ((normalized as any)?._raw && (normalized as any)._raw.bio) || (localProfile as any)?.bio || ''
  );
  const [location, setLocation] = useState<string>(
    onboardingData.location || ((normalized as any)?._raw && (normalized as any)._raw.location) || (localProfile as any)?.location || ''
  );
  const [skills, setSkills] = useState<string[]>(
    onboardingData.skills.length > 0
      ? onboardingData.skills
      : ((normalized as any)?._raw && (normalized as any)._raw.skills) || (localProfile as any)?.skills || []
  );
  const [customSkill, setCustomSkill] = useState('');
  const [saving, setSaving] = useState(false);
  const [avatarUri, setAvatarUri] = useState<string | undefined>(
    onboardingData.avatarUri || undefined
  );
  const [uploading, setUploading] = useState(false);

  // Hunter-flow-only state
  const [hunterStep, setHunterStep] = useState<'location' | 'sample'>('location');
  const [recentBounties, setRecentBounties] = useState<Bounty[] | null>(null);
  const [applying, setApplying] = useState(false);

  // Poster-flow-only state
  const [posting, setPosting] = useState(false);
  const [posterStep, setPosterStep] = useState<'task' | 'funding'>('task');
  // AddMoneyScreen calls onAddMoney then immediately onBack on a successful
  // deposit. This ref (synchronous, unlike state) lets our onBack handler
  // detect that case and skip resetting posterStep back to 'task' while the
  // bounty is being created in the background.
  const postingRef = useRef(false);

  useEffect(() => {
    if (onboardingData.intent !== 'hunter') return;
    let cancelled = false;
    bountyService
      .getAll({ status: 'open', limit: 2 })
      .then((bounties) => {
        if (!cancelled) setRecentBounties(bounties);
      })
      .catch(() => {
        if (!cancelled) setRecentBounties([]);
      });
    return () => {
      cancelled = true;
    };
  }, [onboardingData.intent]);

  // Sync state changes to context
  useEffect(() => {
    updateOnboardingData({ displayName });
  }, [displayName]);

  useEffect(() => {
    updateOnboardingData({ title });
  }, [title]);

  useEffect(() => {
    updateOnboardingData({ bio });
  }, [bio]);

  useEffect(() => {
    updateOnboardingData({ location });
  }, [location]);

  useEffect(() => {
    updateOnboardingData({ skills });
  }, [skills]);

  useEffect(() => {
    if (avatarUri) {
      updateOnboardingData({ avatarUri });
    }
  }, [avatarUri]);

  const pickAvatar = async () => {
    const showPicker = async () => {
      return new Promise<'camera' | 'library' | null>((resolve) => {
        const options = ['Take Photo', 'Choose from Library', 'Cancel'];
        if (Platform.OS === 'ios') {
          ActionSheetIOS.showActionSheetWithOptions(
            {
              options,
              cancelButtonIndex: 2,
            },
            (buttonIndex: number) => {
              if (buttonIndex === 0) resolve('camera');
              else if (buttonIndex === 1) resolve('library');
              else resolve(null);
            }
          );
        } else {
          Alert.alert(
            'Select Photo',
            'Choose a source',
            [
              { text: 'Take Photo', onPress: () => resolve('camera') },
              { text: 'Choose from Library', onPress: () => resolve('library') },
              { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
            ],
            { cancelable: true, onDismiss: () => resolve(null) }
          );
        }
      });
    };

    const source = await showPicker();
    if (!source) return;

    let result: ImagePicker.ImagePickerResult;

    if (source === 'camera') {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission required', 'Please allow camera access to take a profile picture.');
        return;
      }
      result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.9,
      });
    } else {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission required', 'Please allow photo access to select a profile picture.');
        return;
      }
      result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.9,
      });
    }

    if (result.canceled) return;
    const asset = result.assets?.[0];
    if (!asset) return;
    // Optional size guard
    const MAX_FILE_SIZE = 5 * 1024 * 1024;
    if ((asset as any).fileSize && (asset as any).fileSize > MAX_FILE_SIZE) {
      Alert.alert('Image too large', 'Please select an image under 5MB.');
      return;
    }
    // Upload via attachment service to get a stable URL
    try {
      setUploading(true);
      const uploaded = await attachmentService.upload({
        id: `onboarding-avatar-${Date.now()}`,
        name: (asset as any).fileName || 'avatar.jpg',
        uri: asset.uri,
        mimeType: asset.mimeType || 'image/jpeg',
        size: (asset as any).fileSize,
        status: 'uploading',
        progress: 0,
      } as any);
      setAvatarUri(uploaded.remoteUri || asset.uri);
    } catch {
      setAvatarUri(asset.uri);
    } finally {
      setUploading(false);
    }
  };

  const toggleSkill = (skill: string) => {
    if (skills.includes(skill)) {
      setSkills(skills.filter(s => s !== skill));
    } else {
      setSkills([...skills, skill]);
    }
  };

  const addCustomSkill = () => {
    const trimmedSkill = customSkill.trim();
    if (trimmedSkill && !skills.includes(trimmedSkill)) {
      setSkills([...skills, trimmedSkill]);
      setCustomSkill('');
    }
  };

  const removeSkill = (skill: string) => {
    setSkills(skills.filter(s => s !== skill));
  };

  const handleNext = async () => {
    setSaving(true);

    // Save to local storage with all fields
    const result = await updateProfile({
      displayName: displayName.trim() || undefined,
      title: (title.trim() || undefined) as any,
      bio: (bio.trim() || undefined) as any,
      location: (location.trim() || undefined) as any,
      skills: skills.length > 0 ? skills : undefined,
      avatar: avatarUri || undefined,
    } as any);

    if (!result.success) {
      setSaving(false);
      Alert.alert('Error', result.error || 'Failed to save details');
      return;
    }

    // Sync all fields to Supabase via direct update
    // This ensures profile data persists to the database and is available across devices
    // We update the profiles table directly to ensure all fields are saved
    const saveToSupabase = async () => {
      const resolvedUserId = userId || session?.user?.id;
      if (!resolvedUserId) {
        console.error('[Onboarding Details] Cannot save profile: missing authenticated user id');
        return false;
      }

      const profileUpdate: Partial<Profile> = {};

      if (displayName.trim()) {
        profileUpdate.display_name = displayName.trim();
      }
      if (title.trim()) {
        profileUpdate.title = title.trim();
      }
      if (bio.trim()) {
        profileUpdate.about = bio.trim();
      }
      if (location.trim()) {
        profileUpdate.location = location.trim();
      }
      if (skills.length > 0) {
        profileUpdate.skills = skills;
      }
      // Only persist avatar when we have a confirmed remote URI,
      // not a local file:// path that would break on other devices.
      if (avatarUri && !avatarUri.startsWith('file://')) {
        profileUpdate.avatar = avatarUri;
      }

      // Only update if we have fields to save
      if (Object.keys(profileUpdate).length === 0) {
        return true;
      }

      const { error } = await supabase
        .from('profiles')
        .update(profileUpdate)
        .eq('id', resolvedUserId);

      if (error) {
        console.error('[Onboarding Details] Error saving to Supabase:', error);
        return false;
      }

      console.log('[Onboarding Details] Successfully saved profile data to database');
      return true;
    };

    try {
      const success = await saveToSupabase();

      if (!success) {
        setSaving(false);

        // Handle retry attempts with user feedback - allows up to 3 total attempts
        const handleRetryAttempts = async () => {
          setSaving(true);
          const retrySuccess = await saveToSupabase();
          if (retrySuccess) {
            setSaving(false);
            router.push('/onboarding/done');
          } else {
            setSaving(false);
            // Show option to skip after second failed attempt
            Alert.alert(
              'Still Unable to Save',
              'We could not save your profile. You can skip this step and update your profile later.',
              [
                {
                  text: 'Try One More Time',
                  onPress: async () => {
                    setSaving(true);
                    const finalSuccess = await saveToSupabase();
                    setSaving(false);
                    if (finalSuccess) {
                      router.push('/onboarding/done');
                    } else {
                      // After 3 attempts, just allow skip
                      Alert.alert('Unable to Save', 'Please skip for now and try again later from your profile settings.', [
                        { text: 'OK', onPress: () => router.push('/onboarding/done') }
                      ]);
                    }
                  }
                },
                { text: 'Skip for now', style: 'cancel', onPress: () => router.push('/onboarding/done') }
              ]
            );
          }
        };

        Alert.alert(
          'Connection Error',
          'Failed to save your profile. Please check your internet connection and try again.',
          [
            {
              text: 'Retry',
              onPress: handleRetryAttempts,
            },
            {
              text: 'Skip for now',
              style: 'cancel',
              onPress: () => router.push('/onboarding/done'),
            },
          ]
        );
        return;
      }
    } catch (error) {
      console.error('[Onboarding Details] Exception saving to Supabase:', error);
      setSaving(false);
      Alert.alert(
        'Connection Error',
        'An unexpected error occurred. You can skip this step and update your profile later.',
        [
          {
            text: 'Skip for now',
            style: 'cancel',
            onPress: () => router.push('/onboarding/done'),
          },
        ]
      );
      return;
    }

    setSaving(false);
    router.push('/onboarding/done');
  };

  const handleSkip = () => {
    router.push('/onboarding/done');
  };

  const handleBack = () => {
    router.back();
  };

  // Last-resort skip: bypass the rest of onboarding (connect, etc.) entirely
  // and drop the user straight into the app. Marks onboarding as complete so
  // they aren't routed back here on next launch.
  const handleSkipToApp = async () => {
    const resolvedUserId = userId || session?.user?.id;

    if (resolvedUserId) {
      try {
        await AsyncStorage.setItem(getOnboardingCompleteKey(resolvedUserId), 'true');
      } catch (err) {
        console.error('[Onboarding] Skip: AsyncStorage write failed:', err);
      }
    }

    try {
      await authProfileService.updateProfile({ onboarding_completed: true } as any);
    } catch (err) {
      console.error('[Onboarding] Skip: updateProfile failed:', err);
    }

    router.replace('/tabs/bounty-app');
  };

  const handleUseLocation = async () => {
    const permission = await locationService.requestPermission();
    if (!permission.granted) {
      Alert.alert(
        'Location permission needed',
        'Enable location access so we can show you bounties near you, or browse by ZIP instead.'
      );
      return;
    }

    const coords = await locationService.getCurrentLocation();
    if (coords) {
      const address = await locationService.reverseGeocode(coords);
      setLocation(address || `${coords.latitude.toFixed(3)}, ${coords.longitude.toFixed(3)}`);
    }

    setHunterStep('sample');
  };

  const handleSubmitZip = async (zip: string) => {
    if (zip.trim()) {
      setLocation(zip.trim());
      // Save as user metadata (only if they actually chose to enter one) so
      // they can be matched to bounties posted in the same ZIP later.
      try {
        await updateAuthProfile({ zip_code: zip.trim() });
      } catch (err) {
        console.error('[Onboarding] Failed to save zip code to profile:', err);
      }
    }
    setHunterStep('sample');
  };

  // Derives a valid bounty title (5-120 chars) from the free-form "what +
  // when + where" description the user typed.
  const deriveTitleFromDescription = (text: string): string => {
    const trimmed = text.trim();
    if (trimmed.length <= 60) return trimmed;
    const truncated = trimmed.slice(0, 60);
    const lastSpace = truncated.lastIndexOf(' ');
    return (lastSpace > 20 ? truncated.slice(0, lastSpace) : truncated).trim();
  };

  // Validates the task screen's inputs, then moves on to the funding step —
  // the actual bounty isn't created until funding is resolved (paid via
  // createBountyNow(false), or skipped as an honor bounty via
  // createBountyNow(true)).
  const handlePostBounty = () => {
    const description = onboardingData.taskDescription.trim();
    const descriptionError = validateDescription(description);
    if (descriptionError) {
      Alert.alert('Tell us more', descriptionError);
      return;
    }

    const title = deriveTitleFromDescription(description);
    const titleError = validateTitle(title);
    if (titleError) {
      Alert.alert('Tell us more', titleError);
      return;
    }

    const amount = Number(onboardingData.price);
    const amountError = validateAmount(amount, false);
    if (!onboardingData.price || Number.isNaN(amount) || amountError) {
      Alert.alert('Set a price', amountError || 'Enter a valid price for this bounty.');
      return;
    }

    setPosterStep('funding');
  };

  // Creates the real bounty row. isForHonor=false requires the poster's
  // wallet balance to already cover `amount` — a DB trigger
  // (fn_reserve_bounty_escrow) atomically reserves escrow on insert and
  // rolls back the whole insert with an "Insufficient funds" error if not.
  // Returns true on success so callers know whether to navigate onward.
  const createBountyNow = async (isForHonor: boolean): Promise<boolean> => {
    const description = onboardingData.taskDescription.trim();
    const title = deriveTitleFromDescription(description);
    const amount = Number(onboardingData.price) || 0;

    setPosting(true);
    try {
      await bountyCreationService.createBounty({
        title,
        description,
        amount: isForHonor ? 0 : amount,
        isForHonor,
        location: onboardingData.location || 'Nearby',
        workType: 'in_person',
        scheduleType:
          onboardingData.schedule === 'saturday'
            ? 'scheduled'
            : onboardingData.schedule === 'flexible'
              ? 'flexible'
              : undefined,
        timeline:
          onboardingData.schedule === 'saturday'
            ? 'Saturday'
            : onboardingData.schedule === 'flexible'
              ? 'Flexible'
              : undefined,
      });
      router.push('/onboarding/done');
      return true;
    } catch (err) {
      console.error('[Onboarding] Failed to post bounty:', err);
      const message = err instanceof Error ? err.message : 'Please try again.';
      if (/insufficient funds/i.test(message)) {
        Alert.alert(
          'Not enough funds yet',
          `Your wallet doesn't have enough to cover $${amount}. Add more, or skip and post this for free instead.`
        );
      } else {
        Alert.alert('Could not post bounty', message);
      }
      return false;
    } finally {
      setPosting(false);
    }
  };

  const handleFundingSuccess = async () => {
    postingRef.current = true;
    try {
      await createBountyNow(false);
    } finally {
      postingRef.current = false;
    }
  };

  const handleSkipFunding = async () => {
    await createBountyNow(true);
  };

  const handleApplyToSample = async () => {
    const sampleBounty = recentBounties && recentBounties.length > 0 ? recentBounties[0] : null;
    const hunterId = userId || session?.user?.id;

    if (!sampleBounty || !hunterId) {
      // No real bounty to apply to (mock preview / no session) — just continue.
      router.push('/onboarding/done');
      return;
    }

    setApplying(true);
    try {
      const result = await bountyRequestService.create({
        bounty_id: String(sampleBounty.id),
        hunter_id: hunterId,
        status: 'pending',
      } as any);
      if (!result.success) {
        console.warn('[Onboarding] Bounty application failed:', result.error);
      }
    } catch (err) {
      console.error('[Onboarding] Failed to apply to sample bounty:', err);
    } finally {
      setApplying(false);
      router.push('/onboarding/done');
    }
  };

  if (onboardingData.intent === 'poster') {
    if (posterStep === 'funding') {
      return (
        <PosterFundingScreen
          styles={styles}
          price={onboardingData.price}
          posting={posting}
          onBack={() => {
            if (postingRef.current) return;
            setPosterStep('task');
          }}
          onFunded={handleFundingSuccess}
          onSkip={handleSkipFunding}
        />
      );
    }
    return (
      <PosterTaskPrompt
        theme={theme}
        styles={styles}
        insets={insets}
        taskDescription={onboardingData.taskDescription}
        onChangeTaskDescription={(taskDescription) => updateOnboardingData({ taskDescription })}
        price={onboardingData.price}
        onChangePrice={(price) => updateOnboardingData({ price })}
        schedule={onboardingData.schedule}
        onChangeSchedule={(schedule) => updateOnboardingData({ schedule })}
        onNext={handlePostBounty}
        posting={posting}
        onSkip={handleSkipToApp}
      />
    );
  }

  if (onboardingData.intent === 'hunter') {
    if (hunterStep === 'location') {
      return (
        <HunterLocationPrompt
          theme={theme}
          styles={styles}
          insets={insets}
          displayName={displayName || (normalized as any)?.name || 'there'}
          recentBounties={recentBounties}
          onUseLocation={handleUseLocation}
          onSubmitZip={handleSubmitZip}
          onSkip={() => setHunterStep('sample')}
        />
      );
    }
    return (
      <HunterSampleBountyScreen
        theme={theme}
        styles={styles}
        insets={insets}
        recentBounties={recentBounties}
        onNext={handleApplyToSample}
        applying={applying}
        onSkip={handleSkipToApp}
      />
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 100 }]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header with Back Button and Branding */}
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={handleBack} style={styles.backButton}>
            <MaterialIcons name="arrow-back" size={24} color={theme.textSecondary} />
          </TouchableOpacity>
          <View style={styles.brandingHeader}>
            <BrandingLogo size="small" />
          </View>
          <View style={{ width: 40 }} />
        </View>

        {/* Avatar picker - Prominent placement at top */}
        <View style={styles.avatarSection}>
          <TouchableOpacity style={styles.avatarContainer} onPress={pickAvatar} disabled={uploading}>
            {avatarUri ? (
              <View style={styles.avatarImageWrapper}>
                <Image source={{ uri: avatarUri }} style={styles.avatarImage} resizeMode="cover" />
              </View>
            ) : (
              <View style={styles.avatarPlaceholder}>
                <MaterialIcons name="account-circle" size={80} color={theme.textDisabled} />
              </View>
            )}
            <View style={styles.avatarEditBadge}>
              <MaterialIcons name="camera-alt" size={18} color="#052e1b" />
            </View>
          </TouchableOpacity>
          <Text style={styles.avatarHint}>
            {uploading ? 'Uploading…' : 'Tap to add a profile photo'}
          </Text>
          <Text style={styles.avatarSubhint}>
            A profile photo helps others recognize you
          </Text>
        </View>

        {/* Title */}
        <View style={styles.header}>
          <Text style={styles.title}>Tell Us About Yourself</Text>
          <Text style={styles.subtitle}>
            These details help others learn more about you. All fields are optional.
          </Text>
        </View>

        {/* Inputs */}
        <View style={styles.inputSection}>
          {/* Display Name */}
          <View style={styles.field}>
            <Text style={styles.label}>Display Name</Text>
            <TextInput
              style={styles.input}
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="e.g., John Doe"
              placeholderTextColor={theme.textDisabled}
              autoCapitalize="words"
            />
            <Text style={styles.hint}>
              How you
              {"'"}
              d like to be called
            </Text>
          </View>

          {/* Title/Profession */}
          <View style={styles.field}>
            <Text style={styles.label}>Title/Profession</Text>
            <TextInput
              style={styles.input}
              value={title}
              onChangeText={setTitle}
              placeholder="e.g., Full Stack Developer"
              placeholderTextColor={theme.textDisabled}
              autoCapitalize="words"
            />
            <Text style={styles.hint}>Your professional title or role</Text>
          </View>

          {/* Bio */}
          <View style={styles.field}>
            <Text style={styles.label}>Bio</Text>
            <TextInput
              style={[styles.input, styles.bioInput]}
              value={bio}
              onChangeText={setBio}
              placeholder="Tell others about yourself..."
              placeholderTextColor={theme.textDisabled}
              multiline
              numberOfLines={3}
              maxLength={200}
            />
            <Text style={styles.hint}>{bio.length}/200 characters</Text>
          </View>

          {/* Location */}
          <View style={styles.field}>
            <Text style={styles.label}>Location</Text>
            <TextInput
              style={styles.input}
              value={location}
              onChangeText={setLocation}
              placeholder="e.g., San Francisco, CA"
              placeholderTextColor={theme.textDisabled}
              autoCapitalize="words"
            />
            <Text style={styles.hint}>City and state/country</Text>
          </View>

          {/* Skills */}
          <View style={styles.field}>
            <Text style={styles.label}>Skills</Text>
            <Text style={styles.hintWithMargin}>
              What can you help with?
            </Text>

            {/* Common skills as chips */}
            <View style={styles.skillsContainer}>
              {COMMON_SKILLS.map((skill) => (
                <TouchableOpacity
                  key={skill}
                  style={[
                    styles.skillChip,
                    skills.includes(skill) && styles.skillChipSelected,
                  ]}
                  onPress={() => toggleSkill(skill)}
                >
                  <Text
                    style={[
                      styles.skillChipText,
                      skills.includes(skill) && styles.skillChipTextSelected,
                    ]}
                  >
                    {skill}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Custom skills */}
            {skills.filter(s => !COMMON_SKILLS.includes(s)).length > 0 && (
              <View style={styles.customSkillsContainer}>
                {skills.filter(s => !COMMON_SKILLS.includes(s)).map((skill) => (
                  <View key={skill} style={styles.customSkillChip}>
                    <Text style={styles.customSkillText}>{skill}</Text>
                    <TouchableOpacity onPress={() => removeSkill(skill)}>
                      <MaterialIcons name="close" size={16} color={theme.textSecondary} />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}

            {/* Add custom skill */}
            <View style={styles.customSkillInput}>
              <TextInput
                style={styles.input}
                value={customSkill}
                onChangeText={setCustomSkill}
                placeholder="Add another skill..."
                placeholderTextColor={theme.textDisabled}
                onSubmitEditing={addCustomSkill}
                returnKeyType="done"
              />
              {customSkill.trim() && (
                <TouchableOpacity
                  style={styles.addSkillButton}
                  onPress={addCustomSkill}
                >
                  <MaterialIcons name="add" size={20} color="#052e1b" />
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>

        {/* Action Buttons */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.nextButton}
            onPress={handleNext}
            disabled={saving}
          >
            <Text style={styles.nextButtonText}>
              {saving ? 'Saving...' : 'Next'}
            </Text>
            <MaterialIcons name="arrow-forward" size={20} color="#052e1b" />
          </TouchableOpacity>

          <TouchableOpacity onPress={handleSkip} style={styles.skipButton}>
            <Text style={styles.skipButtonText}>Skip for now</Text>
          </TouchableOpacity>
        </View>

        {/* Progress indicator — step 2 of 5 */}
        <View style={styles.progressContainer}>
          <View style={styles.progressDot} />
          <View style={[styles.progressDot, styles.progressDotActive]} />
          <View style={styles.progressDot} />
          <View style={styles.progressDot} />
          <View style={styles.progressDot} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.background,
    },
    scrollContent: {
      flexGrow: 1,
      paddingHorizontal: 24,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 8,
      marginBottom: 16,
    },
    backButton: {
      padding: 8,
    },
    brandingHeader: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    brandingText: {
      fontSize: 18,
      fontWeight: 'bold',
      color: theme.text,
      letterSpacing: 2,
      marginLeft: 6,
    },
    avatarSection: {
      alignItems: 'center',
      marginBottom: 20,
    },
    avatarContainer: {
      position: 'relative',
    },
    avatarImageWrapper: {
      width: 100,
      height: 100,
      borderRadius: 50,
      overflow: 'hidden',
      borderWidth: 3,
      borderColor: theme.border,
    },
    avatarImage: {
      width: '100%',
      height: '100%',
    },
    avatarPlaceholder: {
      width: 100,
      height: 100,
      borderRadius: 50,
      backgroundColor: theme.surface,
      borderWidth: 3,
      borderColor: theme.border,
      justifyContent: 'center',
      alignItems: 'center',
    },
    avatarEditBadge: {
      position: 'absolute',
      bottom: 0,
      right: 0,
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: theme.primary,
      justifyContent: 'center',
      alignItems: 'center',
      borderWidth: 2,
      borderColor: theme.background,
    },
    avatarHint: {
      color: theme.textSecondary,
      fontSize: 14,
      fontWeight: '600',
      marginTop: 8,
    },
    avatarSubhint: {
      color: theme.textSecondary,
      fontSize: 12,
      marginTop: 4,
    },
    header: {
      alignItems: 'center',
      marginBottom: 24,
    },
    title: {
      fontSize: 24,
      fontWeight: 'bold',
      color: theme.text,
      marginBottom: 8,
      textAlign: 'center',
    },
    subtitle: {
      fontSize: 14,
      color: theme.textSecondary,
      textAlign: 'center',
      lineHeight: 20,
      paddingHorizontal: 16,
    },
    inputSection: {
      marginBottom: 24,
    },
    field: {
      marginBottom: 20,
    },
    label: {
      color: theme.textSecondary,
      fontSize: 14,
      fontWeight: '600',
      marginBottom: 8,
    },
    input: {
      backgroundColor: theme.surfaceSecondary,
      borderRadius: 12,
      paddingHorizontal: 16,
      paddingVertical: 12,
      fontSize: 16,
      color: theme.text,
      borderWidth: 1,
      borderColor: theme.border,
    },
    bioInput: {
      minHeight: 80,
      textAlignVertical: 'top',
      paddingTop: 12,
    },
    hint: {
      color: theme.textSecondary,
      fontSize: 12,
      marginTop: 6,
      paddingHorizontal: 4,
    },
    hintWithMargin: {
      color: theme.textSecondary,
      fontSize: 12,
      marginTop: 6,
      marginBottom: 8,
      paddingHorizontal: 4,
    },
    skillsContainer: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginBottom: 12,
    },
    skillChip: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 20,
      backgroundColor: theme.surface,
      borderWidth: 2,
      borderColor: theme.border,
    },
    skillChipSelected: {
      backgroundColor: theme.primary,
      borderColor: theme.primary,
    },
    skillChipText: {
      color: theme.textSecondary,
      fontSize: 14,
      fontWeight: '500',
    },
    skillChipTextSelected: {
      color: '#052e1b',
      fontWeight: '600',
    },
    customSkillsContainer: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginBottom: 12,
    },
    customSkillChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 20,
      backgroundColor: theme.surfaceSecondary,
      borderWidth: 1,
      borderColor: theme.border,
    },
    customSkillText: {
      color: theme.textSecondary,
      fontSize: 14,
      fontWeight: '500',
    },
    customSkillInput: {
      position: 'relative',
    },
    addSkillButton: {
      position: 'absolute',
      right: 8,
      top: 8,
      backgroundColor: theme.primary,
      width: 36,
      height: 36,
      borderRadius: 18,
      justifyContent: 'center',
      alignItems: 'center',
    },
    actions: {
      marginBottom: 24,
    },
    nextButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.primary,
      paddingVertical: 16,
      borderRadius: 999,
      marginBottom: 12,
      gap: 8,
    },
    nextButtonText: {
      color: '#052e1b',
      fontSize: 18,
      fontWeight: 'bold',
    },
    skipButton: {
      alignItems: 'center',
      paddingVertical: 12,
    },
    skipButtonText: {
      color: theme.textSecondary,
      fontSize: 16,
    },
    progressContainer: {
      flexDirection: 'row',
      justifyContent: 'center',
      gap: 8,
      paddingTop: 16,
    },
    progressDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: theme.border,
    },
    progressDotActive: {
      backgroundColor: theme.primary,
    },
    posterContent: {
      flex: 1,
      paddingHorizontal: 24,
    },
    posterHeading: {
      fontSize: 30,
      fontWeight: '600',
      color: theme.text,
      textAlign: 'center',
      marginTop: 24,
      marginBottom: 32,
    },
    dottedBox: {
      borderWidth: 2,
      borderStyle: 'dashed',
      borderColor: theme.isDark ? 'rgba(255,255,255,0.35)' : theme.textSecondary,
      backgroundColor: theme.isDark ? 'rgba(255,255,255,0.06)' : 'transparent',
      borderRadius: 12,
      padding: 16,
      marginBottom: 24,
    },
    dottedBoxLabel: {
      color: theme.isDark ? 'rgba(255,255,255,0.75)' : theme.textSecondary,
      fontSize: 14,
      fontWeight: '600',
      marginBottom: 8,
    },
    dottedBoxExample: {
      color: theme.isDark ? 'rgba(255,255,255,0.75)' : theme.textSecondary,
      fontSize: 15,
      lineHeight: 22,
      fontStyle: 'italic',
    },
    dottedBoxInput: {
      color: theme.text,
      fontSize: 15,
      lineHeight: 22,
      minHeight: 44,
      padding: 0,
      textAlignVertical: 'top',
    },
    priceBox: {
      borderWidth: 2,
      borderColor: theme.primary,
      backgroundColor: theme.surface,
      borderRadius: 16,
      padding: 16,
    },
    priceBoxHint: {
      color: theme.textSecondary,
      fontSize: 13,
      marginBottom: 12,
    },
    priceInputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 16,
    },
    priceInputPill: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: '#ffffff',
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 10,
      paddingHorizontal: 14,
      paddingVertical: 10,
      gap: 6,
    },
    priceCurrency: {
      fontSize: 20,
      fontWeight: '700',
      color: '#111827',
    },
    priceInput: {
      fontSize: 20,
      fontWeight: '700',
      color: '#111827',
      minWidth: 40,
      padding: 0,
    },
    priceSimilarText: {
      color: theme.textSecondary,
      fontSize: 13,
      marginLeft: 12,
    },
    priceChipsRow: {
      flexDirection: 'row',
      gap: 8,
    },
    priceChip: {
      borderWidth: 1.5,
      borderColor: theme.text,
      borderRadius: 999,
      paddingHorizontal: 18,
      paddingVertical: 8,
    },
    priceChipSelected: {
      backgroundColor: theme.primary,
      borderColor: theme.primary,
    },
    priceChipText: {
      color: theme.text,
      fontSize: 14,
      fontWeight: '600',
    },
    priceChipTextSelected: {
      color: '#052e1b',
    },
    posterActions: {
      paddingHorizontal: 24,
      paddingBottom: 40,
    },
    posterDotsContainer: {
      flexDirection: 'row',
      justifyContent: 'center',
      gap: 8,
      paddingTop: 16,
    },
    posterDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: theme.border,
    },
    posterDotActive: {
      backgroundColor: theme.primary,
    },
    hunterContent: {
      flex: 1,
      paddingHorizontal: 24,
    },
    hunterStatusRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingTop: 16,
      marginBottom: 32,
      gap: 8,
    },
    hunterStatusDots: {
      flexDirection: 'row',
      gap: 4,
    },
    hunterStatusDot: {
      width: 7,
      height: 7,
      borderRadius: 3.5,
      backgroundColor: theme.text,
    },
    hunterStatusDotHollow: {
      backgroundColor: 'transparent',
      borderWidth: 1.5,
      borderColor: theme.text,
    },
    hunterStatusSeparator: {
      color: theme.textSecondary,
      fontSize: 14,
    },
    hunterStatusText: {
      color: theme.textSecondary,
      fontSize: 14,
    },
    hunterStatusName: {
      color: theme.text,
      fontWeight: '700',
    },
    bountyCard: {
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 16,
      padding: 16,
      marginBottom: 16,
    },
    bountyCardTopRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 8,
    },
    bountyCardTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: theme.textSecondary,
    },
    bountyCardPrice: {
      fontSize: 18,
      fontWeight: '700',
      color: theme.textSecondary,
    },
    bountyCardMetaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    bountyCardMetaText: {
      fontSize: 14,
      color: theme.textDisabled,
    },
    hunterHeading: {
      fontSize: 28,
      fontWeight: '700',
      color: theme.text,
      textAlign: 'center',
      marginTop: 8,
      marginBottom: 40,
    },
    hunterSpacer: {
      flex: 1,
    },
    hunterActions: {
      paddingBottom: 16,
      gap: 12,
    },
    locationButton: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 18,
      borderRadius: 999,
    },
    locationButtonText: {
      color: '#ffffff',
      fontSize: 18,
      fontWeight: 'bold',
    },
    zipButton: {
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.surface,
      borderWidth: 2,
      borderColor: theme.text,
      paddingVertical: 18,
      borderRadius: 999,
    },
    zipButtonText: {
      color: theme.text,
      fontSize: 18,
      fontWeight: 'bold',
    },
    zipInputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    zipInput: {
      flex: 1,
      backgroundColor: theme.surface,
      borderWidth: 2,
      borderColor: theme.text,
      borderRadius: 999,
      paddingVertical: 16,
      paddingHorizontal: 20,
      fontSize: 18,
      color: theme.text,
    },
    zipInputButton: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 16,
      paddingHorizontal: 20,
      borderRadius: 999,
    },
    zipInputButtonText: {
      color: '#ffffff',
      fontSize: 18,
      fontWeight: 'bold',
    },
    hunterFootnote: {
      fontSize: 13,
      color: theme.textSecondary,
      textAlign: 'center',
      marginTop: 16,
      marginBottom: 24,
      paddingHorizontal: 16,
    },
    earnBanner: {
      borderWidth: 2,
      borderColor: theme.primary,
      backgroundColor: theme.surface,
      borderRadius: 16,
      paddingVertical: 18,
      alignItems: 'center',
      marginTop: 16,
      marginBottom: 20,
    },
    earnBannerText: {
      fontSize: 18,
      fontWeight: '600',
      color: theme.primary,
    },
    earnBannerAmount: {
      fontWeight: '800',
    },
    sampleCardTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: theme.text,
    },
    sampleCardPrice: {
      fontSize: 18,
      fontWeight: '700',
      color: theme.text,
    },
    viewAcceptButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 14,
      borderRadius: 999,
      marginTop: 14,
    },
    viewAcceptButtonText: {
      color: '#ffffff',
      fontSize: 16,
      fontWeight: 'bold',
    },
    detailSheet: {
      borderWidth: 2,
      borderColor: theme.text,
      borderRadius: 16,
      padding: 16,
      marginTop: 16,
    },
    detailSheetLabel: {
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 1,
      color: theme.textSecondary,
      marginBottom: 8,
    },
    detailSheetText: {
      fontSize: 17,
      fontWeight: '700',
      color: theme.text,
    },
    skipLink: {
      alignItems: 'center',
      paddingVertical: 12,
    },
    skipLinkText: {
      fontSize: 15,
      color: theme.textDisabled,
      textDecorationLine: 'underline',
    },
    fundingContainer: {
      flex: 1,
      backgroundColor: '#059669',
    },
    fundingBanner: {
      paddingHorizontal: 24,
      paddingTop: 16,
      paddingBottom: 8,
      alignItems: 'center',
    },
    fundingBannerText: {
      color: '#ffffff',
      fontSize: 16,
      fontWeight: '700',
      textAlign: 'center',
    },
    fundingAddMoneyWrapper: {
      flex: 1,
    },
    fundingSkipLinkText: {
      fontSize: 15,
      color: 'rgba(255,255,255,0.8)',
      textDecorationLine: 'underline',
    },
  });
}

type PosterTaskPromptProps = {
  theme: AppTheme;
  styles: ReturnType<typeof makeStyles>;
  insets: { top: number; bottom: number };
  taskDescription: string;
  onChangeTaskDescription: (taskDescription: string) => void;
  price: string;
  onChangePrice: (price: string) => void;
  schedule: 'saturday' | 'flexible' | null;
  onChangeSchedule: (schedule: 'saturday' | 'flexible' | null) => void;
  onNext: () => void;
  posting: boolean;
  onSkip: () => void;
};

function PosterTaskPrompt({
  theme,
  styles,
  insets,
  taskDescription,
  onChangeTaskDescription,
  price,
  onChangePrice,
  schedule,
  onChangeSchedule,
  onNext,
  posting,
  onSkip,
}: PosterTaskPromptProps) {
  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.posterDotsContainer}>
        <View style={[styles.posterDot, styles.posterDotActive]} />
        <View style={[styles.posterDot, styles.posterDotActive]} />
        <View style={styles.posterDot} />
      </View>

      <View style={[styles.posterContent, { paddingBottom: insets.bottom }]}>
        <Text style={styles.posterHeading}>What do you need done?</Text>

        <View style={styles.dottedBox}>
          <Text style={styles.dottedBoxLabel}>What + when + where</Text>
          <TextInput
            style={styles.dottedBoxInput}
            value={taskDescription}
            onChangeText={onChangeTaskDescription}
            placeholder="Help me move a couch, Saturday morning, Mission District"
            placeholderTextColor={theme.isDark ? 'rgba(255,255,255,0.75)' : theme.textSecondary}
            multiline
            editable={!posting}
          />
        </View>

        <View style={styles.priceBox}>
          <Text style={styles.priceBoxHint}>↓ drafted after you type · tap to change</Text>

          <View style={styles.priceInputRow}>
            <View style={styles.priceInputPill}>
              <Text style={styles.priceCurrency}>$</Text>
              <TextInput
                style={styles.priceInput}
                value={price}
                onChangeText={onChangePrice}
                placeholder="50"
                placeholderTextColor={theme.textDisabled}
                keyboardType="numeric"
              />
              <MaterialIcons name="edit" size={16} color={theme.textSecondary} />
            </View>
            <Text style={styles.priceSimilarText}>similar: $40–60</Text>
          </View>

          <View style={styles.priceChipsRow}>
            <TouchableOpacity
              style={[styles.priceChip, schedule === 'saturday' && styles.priceChipSelected]}
              onPress={() => onChangeSchedule(schedule === 'saturday' ? null : 'saturday')}
            >
              <Text
                style={[styles.priceChipText, schedule === 'saturday' && styles.priceChipTextSelected]}
              >
                Saturday
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.priceChip, schedule === 'flexible' && styles.priceChipSelected]}
              onPress={() => onChangeSchedule(schedule === 'flexible' ? null : 'flexible')}
            >
              <Text
                style={[styles.priceChipText, schedule === 'flexible' && styles.priceChipTextSelected]}
              >
                Flexible
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <View style={styles.posterActions}>
        <TouchableOpacity
          style={[styles.nextButton, { backgroundColor: theme.primary }]}
          onPress={onNext}
          disabled={posting}
        >
          {posting ? (
            <ActivityIndicator color="#052e1b" style={{ marginRight: 8 }} />
          ) : null}
          <Text style={styles.nextButtonText}>
            {posting ? 'Posting…' : 'Post Bounty - free to post'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.skipLink} onPress={onSkip} disabled={posting}>
          <Text style={styles.skipLinkText}>Skip for now</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

type PosterFundingScreenProps = {
  styles: ReturnType<typeof makeStyles>;
  price: string;
  posting: boolean;
  onBack: () => void;
  onFunded: () => void;
  onSkip: () => void;
};

// Lets the poster add a card / deposit funds (reusing the same flow as the
// main app's wallet) so their bounty can post as a real, paid bounty. This
// is a distinct step from the task screen because a DB trigger
// (fn_reserve_bounty_escrow) requires the wallet balance to already cover
// the bounty amount at the moment the bounty row is inserted.
function PosterFundingScreen({ styles, price, posting, onBack, onFunded, onSkip }: PosterFundingScreenProps) {
  return (
    <View style={styles.fundingContainer}>
      <View style={styles.fundingBanner}>
        <Text style={styles.fundingBannerText}>Add ${price || '0'} to post this as a paid bounty</Text>
      </View>

      <View style={styles.fundingAddMoneyWrapper}>
        <AddMoneyScreen initialAmount={price || '0'} onBack={onBack} onAddMoney={onFunded} />
      </View>

      <TouchableOpacity style={styles.skipLink} onPress={onSkip} disabled={posting}>
        <Text style={styles.fundingSkipLinkText}>
          {posting ? 'Posting…' : 'Skip for now — post for free instead'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

type HunterLocationPromptProps = {
  theme: AppTheme;
  styles: ReturnType<typeof makeStyles>;
  insets: { top: number; bottom: number };
  displayName: string;
  recentBounties: Bounty[] | null;
  onUseLocation: () => void;
  onSubmitZip: (zipCode: string) => void;
  onSkip: () => void;
};

// Fallback preview cards shown only if there are no live open bounties yet
// (e.g. a brand new environment with no postings).
const MOCK_PREVIEW_BOUNTIES: { title: string; priceLabel: string; metaLabel: string; amount: number }[] = [
  { title: 'Help move …', priceLabel: '💰 $45', metaLabel: '📍 ~1 mi · ⏰ Today', amount: 45 },
  { title: 'Dog w…', priceLabel: '💰 $20', metaLabel: '📍 ~1 mi · ⏰ Tonight', amount: 20 },
];

function getPreviewCards(recentBounties: Bounty[] | null) {
  return recentBounties && recentBounties.length > 0
    ? recentBounties.slice(0, 2).map((bounty) => ({
        title: bounty.title,
        priceLabel: bounty.is_for_honor ? '🏅 For Honor' : `💰 $${bounty.amount}`,
        metaLabel: `📍 ${
          typeof bounty.distance === 'number' ? `~${Math.round(bounty.distance)} mi` : bounty.location
        } · ⏰ ${bounty.timeline || 'Flexible'}`,
        amount: bounty.amount,
      }))
    : MOCK_PREVIEW_BOUNTIES;
}

function HunterLocationPrompt({
  theme,
  styles,
  insets,
  displayName,
  recentBounties,
  onUseLocation,
  onSubmitZip,
  onSkip,
}: HunterLocationPromptProps) {
  const previewCards = getPreviewCards(recentBounties);
  const [showZipInput, setShowZipInput] = useState(false);
  const [zipInput, setZipInput] = useState('');

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.hunterStatusRow}>
        <View style={styles.hunterStatusDots}>
          <View style={styles.hunterStatusDot} />
          <View style={styles.hunterStatusDot} />
          <View style={styles.hunterStatusDot} />
          <View style={[styles.hunterStatusDot, styles.hunterStatusDotHollow]} />
        </View>
        <Text style={styles.hunterStatusSeparator}>·</Text>
        <Text style={styles.hunterStatusText}>
          Hunting as <Text style={styles.hunterStatusName}>{displayName}</Text>
        </Text>
        <MaterialIcons name="edit" size={16} color={theme.textSecondary} />
      </View>

      <View style={styles.hunterContent}>
        {previewCards.map((card, index) => (
          <View style={styles.bountyCard} key={index}>
            <View style={styles.bountyCardTopRow}>
              <Text style={styles.bountyCardTitle} numberOfLines={1}>{card.title}</Text>
              <Text style={styles.bountyCardPrice}>{card.priceLabel}</Text>
            </View>
            <View style={styles.bountyCardMetaRow}>
              <Text style={styles.bountyCardMetaText}>{card.metaLabel}</Text>
            </View>
          </View>
        ))}

        <Text style={styles.hunterHeading}>See exactly how close{'\n'}the money is</Text>

        <View style={styles.hunterSpacer} />

        <View style={styles.hunterActions}>
          <TouchableOpacity
            style={[styles.locationButton, { backgroundColor: theme.primary }]}
            onPress={onUseLocation}
          >
            <Text style={styles.locationButtonText}>Use my location</Text>
          </TouchableOpacity>

          {showZipInput ? (
            <View style={styles.zipInputRow}>
              <TextInput
                style={styles.zipInput}
                value={zipInput}
                onChangeText={(text) => setZipInput(text.replace(/[^0-9]/g, '').slice(0, 5))}
                placeholder="ZIP code"
                placeholderTextColor={theme.textDisabled}
                keyboardType="number-pad"
                maxLength={5}
                autoFocus
              />
              <TouchableOpacity
                style={[styles.zipInputButton, { backgroundColor: theme.primary, opacity: zipInput.length === 5 ? 1 : 0.5 }]}
                onPress={() => onSubmitZip(zipInput)}
                disabled={zipInput.length !== 5}
              >
                <Text style={styles.zipInputButtonText}>Go</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity style={styles.zipButton} onPress={() => setShowZipInput(true)}>
              <Text style={styles.zipButtonText}>Browse by ZIP instead</Text>
            </TouchableOpacity>
          )}

          <Text style={styles.hunterFootnote}>
            Only your area is stored — never your exact address.
          </Text>

          <TouchableOpacity style={styles.skipLink} onPress={onSkip}>
            <Text style={styles.skipLinkText}>Skip for now</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

type HunterSampleBountyScreenProps = {
  theme: AppTheme;
  styles: ReturnType<typeof makeStyles>;
  insets: { top: number; bottom: number };
  recentBounties: Bounty[] | null;
  onNext: () => void;
  applying: boolean;
  onSkip: () => void;
};

function HunterSampleBountyScreen({
  theme,
  styles,
  insets,
  recentBounties,
  onNext,
  applying,
  onSkip,
}: HunterSampleBountyScreenProps) {
  const previewCards = getPreviewCards(recentBounties);
  const sampleCard = previewCards[0];
  const sampleBounty = recentBounties && recentBounties.length > 0 ? recentBounties[0] : null;

  const bannerAmount =
    recentBounties && recentBounties.length > 0
      ? Math.max(...recentBounties.map((b) => b.amount))
      : 125;

  const detailText = sampleBounty
    ? [
        sampleBounty.timeline,
        sampleBounty.location,
        sampleBounty.duration_minutes ? `${Math.round(sampleBounty.duration_minutes / 60)} hrs` : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : 'Sat 10am · 123 Oak St area · 2 hrs';

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.hunterContent}>
        <View style={styles.earnBanner}>
          <Text style={styles.earnBannerText}>
            Earn up to <Text style={styles.earnBannerAmount}>${bannerAmount}</Text> nearby
          </Text>
        </View>

        <View style={styles.bountyCard}>
          <View style={styles.bountyCardTopRow}>
            <Text style={styles.sampleCardTitle} numberOfLines={1}>{sampleCard.title}</Text>
            <Text style={styles.sampleCardPrice}>{sampleCard.priceLabel}</Text>
          </View>
          <View style={styles.bountyCardMetaRow}>
            <Text style={styles.bountyCardMetaText}>{sampleCard.metaLabel}</Text>
          </View>
          <TouchableOpacity
            style={[styles.viewAcceptButton, { backgroundColor: theme.primary }]}
            onPress={onNext}
            disabled={applying}
          >
            {applying ? (
              <ActivityIndicator color="#ffffff" style={{ marginRight: 8 }} />
            ) : null}
            <Text style={styles.viewAcceptButtonText}>View &amp; accept</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.detailSheet}>
          <Text style={styles.detailSheetLabel}>DETAIL SHEET</Text>
          <Text style={styles.detailSheetText}>{detailText}</Text>
          <TouchableOpacity
            style={[styles.viewAcceptButton, { backgroundColor: theme.primary }]}
            onPress={onNext}
            disabled={applying}
          >
            {applying ? (
              <ActivityIndicator color="#ffffff" style={{ marginRight: 8 }} />
            ) : null}
            <Text style={styles.viewAcceptButtonText}>
              {applying ? 'Applying…' : '✓ I can do this today'}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.hunterSpacer} />

        <Text style={styles.hunterFootnote}>
          Accepted bounty pins to top with next step (&ldquo;Sat 10am · get directions&rdquo;)
        </Text>

        <TouchableOpacity style={styles.skipLink} onPress={onSkip}>
          <Text style={styles.skipLinkText}>Skip for now</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
