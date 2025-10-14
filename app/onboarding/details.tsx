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

export default function DetailsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { profile: localProfile, updateProfile } = useUserProfile();
  const { updateProfile: updateAuthProfile } = useAuthProfile();
  const { profile: normalized } = useNormalizedProfile();

  const [displayName, setDisplayName] = useState(normalized?.name || localProfile?.displayName || '');
  const [location, setLocation] = useState((normalized?._raw && (normalized as any)._raw.location) || localProfile?.location || '');
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
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
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

  const handleNext = async () => {
    setSaving(true);
    
    // Save to local storage
    const result = await updateProfile({
      displayName: displayName.trim() || undefined,
      location: location.trim() || undefined,
      avatar: avatarUri || undefined,
    });

    if (!result.success) {
      setSaving(false);
      Alert.alert('Error', result.error || 'Failed to save details');
      return;
    }

    // Also sync to Supabase via AuthProfileService
    await updateAuthProfile({
      about: location.trim() || undefined,
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
  hint: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    marginTop: 6,
    paddingHorizontal: 4,
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
