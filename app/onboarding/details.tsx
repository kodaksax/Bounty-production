/**
 * Details Onboarding Screen
 * Second step: collect optional display name, avatar, location
 */

import { MaterialIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
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
import { useAuthProfile } from '../../hooks/useAuthProfile';
import { useNormalizedProfile } from '../../hooks/useNormalizedProfile';
import { useUserProfile } from '../../hooks/useUserProfile';
import { attachmentService } from '../../lib/services/attachment-service';

const COMMON_SKILLS = [
  'Handyman', 'Cleaning', 'Moving', 'Delivery', 'Pet Care',
  'Gardening', 'Photography', 'Tutoring', 'Tech Support', 'Design',
];

export default function DetailsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { profile: localProfile, updateProfile } = useUserProfile();
  const { updateProfile: updateAuthProfile } = useAuthProfile();
  const { profile: normalized } = useNormalizedProfile();

  const [displayName, setDisplayName] = useState<string>(
    (normalized as any)?.name || (localProfile as any)?.displayName || ''
  );
  const [bio, setBio] = useState<string>(
    ((normalized as any)?._raw && (normalized as any)._raw.bio) || (localProfile as any)?.bio || ''
  );
  const [location, setLocation] = useState<string>(
    ((normalized as any)?._raw && (normalized as any)._raw.location) || (localProfile as any)?.location || ''
  );
  const [skills, setSkills] = useState<string[]>(
    ((normalized as any)?._raw && (normalized as any)._raw.skills) || (localProfile as any)?.skills || []
  );
  const [customSkill, setCustomSkill] = useState('');
  const [saving, setSaving] = useState(false);
  const [avatarUri, setAvatarUri] = useState<string | undefined>(undefined);
  const [uploading, setUploading] = useState(false);

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
    } catch (e) {
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
    
    // Save to local storage
    const result = await updateProfile({
      displayName: displayName.trim() || undefined,
      // Use flexible typing for optional fields
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      bio: (bio.trim() || undefined) as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      location: (location.trim() || undefined) as any,
      skills: skills.length > 0 ? skills : undefined,
      avatar: avatarUri || undefined,
    } as any);

    if (!result.success) {
      setSaving(false);
      Alert.alert('Error', result.error || 'Failed to save details');
      return;
    }

    // Also sync to Supabase via AuthProfileService
    await updateAuthProfile({
      about: bio.trim() || undefined,
      avatar: avatarUri || undefined,
    });

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
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 160 }]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={handleBack} style={styles.backButton}>
            <MaterialIcons name="arrow-back" size={24} color="#a7f3d0" />
          </TouchableOpacity>
          
          <MaterialIcons name="info-outline" size={64} color="#a7f3d0" />
          <Text style={styles.title}>Tell Us About Yourself</Text>
          <Text style={styles.subtitle}>
            Help others recognize you with a display name and location. These are optional.
          </Text>
        </View>

        {/* Inputs */}
        <View style={styles.inputSection}>
          {/* Display Name */}
          <View style={styles.field}>
            <Text style={styles.label}>Display Name (Optional)</Text>
            <TextInput
              style={styles.input}
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="e.g., John Doe"
              placeholderTextColor="rgba(255,255,255,0.4)"
              autoCapitalize="words"
            />
            <Text style={styles.hint}>How you'd like to be called</Text>
          </View>

          {/* Bio */}
          <View style={styles.field}>
            <Text style={styles.label}>Bio (Optional)</Text>
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
            <Text style={styles.label}>Location (Optional)</Text>
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
            <Text style={styles.label}>Skills (Optional)</Text>
            <Text style={[styles.hint, { marginBottom: 8 }]}>
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

            {/* Avatar picker */}
            <View style={styles.field}>
              <Text style={styles.label}>Profile Picture</Text>
              <TouchableOpacity style={styles.avatarPlaceholder} onPress={pickAvatar} disabled={uploading}>
                {avatarUri ? (
                  <View style={{ width: 96, height: 96, borderRadius: 48, overflow: 'hidden', borderWidth: 2, borderColor: 'rgba(167,243,208,0.6)' }}>
                    <Image source={{ uri: avatarUri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                  </View>
                ) : (
                  <>
                    <MaterialIcons name="account-circle" size={80} color="rgba(255,255,255,0.3)" />
                    <Text style={styles.avatarText}>{uploading ? 'Uploading…' : 'Tap to select a photo'}</Text>
                  </>
                )}
              </TouchableOpacity>
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
  header: {
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 32,
  },
  backButton: {
    position: 'absolute',
    left: 0,
    top: 0,
    padding: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#ffffff',
    marginTop: 16,
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    color: 'rgba(255,255,255,0.8)',
    textAlign: 'center',
    lineHeight: 24,
    paddingHorizontal: 16,
  },
  inputSection: {
    marginBottom: 24,
  },
  field: {
    marginBottom: 24,
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
    paddingVertical: 14,
    fontSize: 16,
    color: '#ffffff',
    borderWidth: 2,
    borderColor: 'rgba(167,243,208,0.3)',
  },
  bioInput: {
    minHeight: 80,
    textAlignVertical: 'top',
    paddingTop: 14,
  },
  hint: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    marginTop: 6,
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
  avatarPlaceholder: {
    backgroundColor: 'rgba(5,46,27,0.5)',
    borderRadius: 12,
    paddingVertical: 24,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'rgba(167,243,208,0.3)',
  },
  avatarText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 14,
    marginTop: 8,
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
