/**
 * Details Onboarding Screen
 * Second step: collect optional display name, avatar, location, title, bio, skills
 * Features: State persistence, profile picture prominence, branding
 */

import { MaterialIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
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
import { BrandingLogo } from '../../components/ui/branding-logo';
import { useAuthProfile } from '../../hooks/useAuthProfile';
import { useNormalizedProfile } from '../../hooks/useNormalizedProfile';
import { useUserProfile } from '../../hooks/useUserProfile';
import { useOnboarding } from '../../lib/context/onboarding-context';
import { attachmentService } from '../../lib/services/attachment-service';
import { supabase } from '../../lib/supabase';

const COMMON_SKILLS = [
  'Handyman', 'Cleaning', 'Moving', 'Delivery', 'Pet Care',
  'Gardening', 'Photography', 'Tutoring', 'Tech Support', 'Design',
];

export default function DetailsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { profile: localProfile, updateProfile } = useUserProfile();
  const { profile: authProfile, userId } = useAuthProfile();
  const { profile: normalized } = useNormalizedProfile();
  const { data: onboardingData, updateData: updateOnboardingData } = useOnboarding();

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
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission required', 'Please allow photo access to select a profile picture.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.9,
    });
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
    try {
      if (userId) {
        const profileUpdate: any = {};
        
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
        if (avatarUri) {
          profileUpdate.avatar = avatarUri;
        }
        
        // Only update if we have fields to save
        if (Object.keys(profileUpdate).length > 0) {
          const { error } = await supabase
            .from('profiles')
            .update(profileUpdate)
            .eq('id', userId);
          
          if (error) {
            console.error('[Onboarding Details] Error saving to Supabase:', error);
            setSaving(false);
            Alert.alert(
              'Connection Error',
              'Failed to save your profile. Please check your internet connection and try again.',
              [
                {
                  text: 'Retry',
                  onPress: () => handleNext(),
                },
                {
                  text: 'Skip for now',
                  style: 'cancel',
                  onPress: () => router.push('/onboarding/phone'),
                },
              ]
            );
            return;
          }
          
          console.log('[Onboarding Details] Successfully saved profile data to database');
        }
      }
    } catch (error) {
      console.error('[Onboarding Details] Exception saving to Supabase:', error);
      setSaving(false);
      Alert.alert(
        'Connection Error',
        'Failed to save your profile. Please check your internet connection and try again.',
        [
          {
            text: 'Retry',
            onPress: () => handleNext(),
          },
          {
            text: 'Skip for now',
            style: 'cancel',
            onPress: () => router.push('/onboarding/phone'),
          },
        ]
      );
      return;
    }

    setSaving(false);
    router.push('/onboarding/phone');
  };

  const handleSkip = () => {
    router.push('/onboarding/phone');
  };

  const handleBack = () => {
    router.back();
  };

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
            <MaterialIcons name="arrow-back" size={24} color="#a7f3d0" />
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
                <MaterialIcons name="account-circle" size={80} color="rgba(255,255,255,0.4)" />
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
              placeholderTextColor="rgba(255,255,255,0.4)"
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
              placeholderTextColor="rgba(255,255,255,0.4)"
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
              placeholderTextColor="rgba(255,255,255,0.4)"
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
              placeholderTextColor="rgba(255,255,255,0.4)"
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
                      <MaterialIcons name="close" size={16} color="#a7f3d0" />
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
                placeholderTextColor="rgba(255,255,255,0.4)"
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

        {/* Progress indicator */}
        <View style={styles.progressContainer}>
          <View style={styles.progressDot} />
          <View style={[styles.progressDot, styles.progressDotActive]} />
          <View style={styles.progressDot} />
          <View style={styles.progressDot} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#059669',
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
    color: '#ffffff',
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
    borderColor: '#a7f3d0',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarPlaceholder: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(5,46,27,0.5)',
    borderWidth: 3,
    borderColor: 'rgba(167,243,208,0.3)',
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
    backgroundColor: '#a7f3d0',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#059669',
  },
  avatarHint: {
    color: '#a7f3d0',
    fontSize: 14,
    fontWeight: '600',
    marginTop: 8,
  },
  avatarSubhint: {
    color: 'rgba(255,255,255,0.7)',
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
    color: '#ffffff',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.8)',
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
    color: '#a7f3d0',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  input: {
    backgroundColor: 'rgba(5,46,27,0.5)',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: '#ffffff',
    borderWidth: 2,
    borderColor: 'rgba(167,243,208,0.3)',
  },
  bioInput: {
    minHeight: 80,
    textAlignVertical: 'top',
    paddingTop: 12,
  },
  hint: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    marginTop: 6,
    paddingHorizontal: 4,
  },
  hintWithMargin: {
    color: 'rgba(255,255,255,0.6)',
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
    backgroundColor: 'rgba(5,46,27,0.5)',
    borderWidth: 2,
    borderColor: 'rgba(167,243,208,0.3)',
  },
  skillChipSelected: {
    backgroundColor: '#a7f3d0',
    borderColor: '#a7f3d0',
  },
  skillChipText: {
    color: 'rgba(255,255,255,0.9)',
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
    backgroundColor: '#097959',
    borderWidth: 1,
    borderColor: '#a7f3d0',
  },
  customSkillText: {
    color: '#a7f3d0',
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
    backgroundColor: '#a7f3d0',
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
    backgroundColor: '#a7f3d0',
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
    color: 'rgba(255,255,255,0.8)',
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
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  progressDotActive: {
    backgroundColor: '#a7f3d0',
  },
});
