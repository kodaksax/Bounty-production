/**
 * Phone Onboarding Screen
 * Third step: collect optional phone number (private, never displayed)
 */

import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUserProfile } from '../../hooks/useUserProfile';
import { useAuthProfile } from '../../hooks/useAuthProfile';

export default function PhoneScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { updateProfile } = useUserProfile();
  const { updateProfile: updateAuthProfile } = useAuthProfile();
  
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);

  const handleNext = async () => {
    setSaving(true);
    
    // Save to local storage
    const result = await updateProfile({
      phone: phone.trim() || undefined,
    });

    if (!result.success) {
      setSaving(false);
      Alert.alert('Error', result.error || 'Failed to save phone number');
      return;
    }

    // Also sync to Supabase via AuthProfileService
    await updateAuthProfile({
      phone: phone.trim() || undefined,
    });

    setSaving(false);
    router.push('/onboarding/done');
  };

  const handleSkip = () => {
    router.push('/onboarding/done');
  };

  const handleBack = () => {
    router.back();
  };

  const formatPhoneDisplay = (text: string) => {
    // Remove all non-digit characters for clean storage
    const digits = text.replace(/\D/g, '');
    setPhone(digits);
  };

  const getDisplayPhone = () => {
    // Format for display only (not stored this way)
    const digits = phone;
    if (digits.length === 0) return '';
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    if (digits.length <= 10) {
      return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    }
    return `+${digits.slice(0, digits.length - 10)} (${digits.slice(-10, -7)}) ${digits.slice(-7, -4)}-${digits.slice(-4)}`;
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
          
          <MaterialIcons name="phone" size={64} color="#a7f3d0" />
          <Text style={styles.title}>Phone Number</Text>
          <Text style={styles.subtitle}>
            Optional. Used for trust and notifications only. Never displayed publicly.
          </Text>
        </View>

        {/* Phone Input */}
        <View style={styles.inputSection}>
          <View style={styles.field}>
            <Text style={styles.label}>Phone Number (Optional & Private)</Text>
            <TextInput
              style={styles.input}
              value={getDisplayPhone()}
              onChangeText={formatPhoneDisplay}
              placeholder="(555) 123-4567"
              placeholderTextColor="rgba(255,255,255,0.4)"
              keyboardType="phone-pad"
              maxLength={20}
            />
            <View style={styles.privacyNote}>
              <MaterialIcons name="lock" size={16} color="#a7f3d0" />
              <Text style={styles.privacyText}>
                Your phone number is private and will never be shown to other users
              </Text>
            </View>
          </View>

          {/* Info box */}
          <View style={styles.infoBox}>
            <MaterialIcons name="info-outline" size={20} color="#a7f3d0" />
            <Text style={styles.infoText}>
              We may use your phone for account verification and important notifications. 
              You can update or remove it anytime in settings.
            </Text>
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
          <View style={styles.progressDot} />
          <View style={[styles.progressDot, styles.progressDotActive]} />
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
    fontSize: 18,
    color: '#ffffff',
    borderWidth: 2,
    borderColor: 'rgba(167,243,208,0.3)',
    letterSpacing: 1,
  },
  privacyNote: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    paddingHorizontal: 4,
  },
  privacyText: {
    color: '#a7f3d0',
    fontSize: 13,
    marginLeft: 6,
    flex: 1,
  },
  infoBox: {
    flexDirection: 'row',
    backgroundColor: 'rgba(5,46,27,0.5)',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(167,243,208,0.3)',
  },
  infoText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 13,
    lineHeight: 20,
    marginLeft: 12,
    flex: 1,
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
