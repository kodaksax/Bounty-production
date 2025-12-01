/**
 * Username Onboarding Screen
 * First step: collect unique username (required)
 * Features: Bounty branding, state persistence via context, modal for legal docs
 */

import { MaterialIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    KeyboardAvoidingView,
    Modal,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PRIVACY_TEXT } from '../../assets/legal/privacy';
import { TERMS_TEXT } from '../../assets/legal/terms';
import { useAuthProfile } from '../../hooks/useAuthProfile';
import { useNormalizedProfile } from '../../hooks/useNormalizedProfile';
import { useUserProfile } from '../../hooks/useUserProfile';
import { useOnboarding } from '../../lib/context/onboarding-context';
import { isUsernameUnique, validateUsername } from '../../lib/services/userProfile';
import { supabase } from '../../lib/supabase';

type LegalModalType = 'terms' | 'privacy' | null;

export default function UsernameScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { profile: localProfile, updateProfile } = useUserProfile();
  const { userId, updateProfile: updateAuthProfile } = useAuthProfile();
  const { profile: normalized } = useNormalizedProfile();
  const { data: onboardingData, updateData: updateOnboardingData } = useOnboarding();
  
  // Initialize state from context
  const [username, setUsername] = useState(onboardingData.username);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [isValid, setIsValid] = useState(false);
  const [accepted, setAccepted] = useState(onboardingData.accepted);
  const [legalModal, setLegalModal] = useState<LegalModalType>(null);

  // Sync from context on mount
  useEffect(() => {
    if (onboardingData.username && onboardingData.username !== username) {
      setUsername(onboardingData.username);
    }
    if (onboardingData.accepted !== accepted) {
      setAccepted(onboardingData.accepted);
    }
  }, []);

  // Load prior acceptance
  useEffect(() => {
    AsyncStorage.getItem('BE:acceptedLegal').then((v) => {
      if (v === 'true' && !accepted) {
        setAccepted(true);
        updateOnboardingData({ accepted: true });
      }
    }).catch(() => {});
  }, []);

  // Persist username to context when it changes
  useEffect(() => {
    updateOnboardingData({ username });
  }, [username]);

  // Persist accepted to context when it changes
  useEffect(() => {
    updateOnboardingData({ accepted });
  }, [accepted]);

  // Validate username on change
  useEffect(() => {
    const checkUsername = async () => {
      if (!username) {
        setError(null);
        setIsValid(false);
        return;
      }

      // Format validation
      const validation = validateUsername(username);
      if (!validation.valid) {
        setError(validation.error ?? null);
        setIsValid(false);
        return;
      }

      // Uniqueness check (debounced)
      setChecking(true);
      setError(null);
      
      const timer = setTimeout(async () => {
        const unique = await isUsernameUnique(username, 'current-user');
        if (!unique) {
          setError('Username is already taken');
          setIsValid(false);
        } else {
          setError(null);
          setIsValid(true);
        }
        setChecking(false);
      }, 500);

      return () => clearTimeout(timer);
    };

    checkUsername();
  }, [username]);

  const handleNext = async () => {
    // Validate prerequisites
    if (!isValid || checking || !accepted) return;

    // Check if user is authenticated
    if (!userId) {
      setError('Please sign in to continue. Your session may have expired.');
      return;
    }

    try {
      // persist acceptance
      try { await AsyncStorage.setItem('BE:acceptedLegal', 'true'); } catch {}
      
      // Save username to local profile service
      const result = await updateProfile({ 
        username,
        displayName: normalized?.name || localProfile?.displayName,
        avatar: normalized?.avatar || localProfile?.avatar,
        location: (normalized?._raw && (normalized as any)._raw.location) || localProfile?.location,
        phone: (normalized?._raw && (normalized as any)._raw.phone) || localProfile?.phone,
      });

      if (!result.success) {
        setError(result.error || 'Failed to save username');
        return;
      }

      // Also save to Supabase profiles table via AuthProfileService
      const { data: existingProfile, error: fetchError } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', userId)
        .single();

      // Handle case where profile doesn't exist (not an error)
      if (fetchError && fetchError.code !== 'PGRST116') {
        console.error('[onboarding] Error fetching profile:', fetchError);
        // Continue anyway - we'll try to create it
      }

      if (existingProfile) {
        const { error: updateError } = await supabase
          .from('profiles')
          .update({ username })
          .eq('id', userId);
        
        if (updateError) {
          // Handle unique constraint violation (username already taken)
          if (updateError.code === '23505') {
            setError('This username is already taken. Please choose another.');
            return;
          }
          console.error('[onboarding] Error updating profile:', updateError);
          setError('Failed to update profile. Please try again.');
          return;
        }
        
        try {
          await updateAuthProfile({ username });
        } catch (authError) {
          console.error('[onboarding] Error updating auth profile:', authError);
          // Don't block navigation since Supabase profile was updated
        }
      } else {
        const { error: insertError } = await supabase
          .from('profiles')
          .insert({
            id: userId,
            username,
            balance: 0,
          });

        if (insertError) {
          // Handle unique constraint violation (username already taken)
          if (insertError.code === '23505') {
            setError('This username is already taken. Please choose another.');
            return;
          }
          console.error('[onboarding] Error creating profile:', insertError);
          setError('Failed to save profile. Please try again.');
          return;
        }

        try {
          await updateAuthProfile({ username });
        } catch (authError) {
          console.error('[onboarding] Error updating auth profile:', authError);
          // Don't block navigation since Supabase profile was created
        }
      }

      router.push('/onboarding/details');
    } catch (err) {
      console.error('[onboarding] Error:', err);
      setError('Failed to save username. Please try again.');
    }
  };

  const renderLegalModal = () => {
    const title = legalModal === 'terms' ? 'Terms of Service' : 'Privacy Policy';
    const content = legalModal === 'terms' ? TERMS_TEXT : PRIVACY_TEXT;
    const paragraphs = content.split(/\n\n+/);

    return (
      <Modal
        visible={!!legalModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setLegalModal(null)}
      >
        <View style={[styles.modalContainer, { paddingTop: insets.top }]}>
          <View style={styles.modalHeader}>
            <MaterialIcons 
              name={legalModal === 'terms' ? 'gavel' : 'privacy-tip'} 
              size={24} 
              color="#aad9b8" 
            />
            <Text style={styles.modalTitle}>{title}</Text>
            <TouchableOpacity 
              onPress={() => setLegalModal(null)} 
              style={styles.modalCloseButton}
              accessibilityLabel="Close"
            >
              <MaterialIcons name="close" size={24} color="#ffffff" />
            </TouchableOpacity>
          </View>
          <ScrollView 
            style={styles.modalScroll}
            contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
          >
            {paragraphs.map((p, i) => (
              <Text key={i} style={styles.modalParagraph}>{p}</Text>
            ))}
          </ScrollView>
        </View>
      </Modal>
    );
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={[styles.content, { paddingBottom: insets.bottom + 40 }]}>
        {/* Branding Header */}
        <View style={styles.brandingHeader}>
          <MaterialIcons name="gps-fixed" size={28} color="#aad9b8" />
          <Text style={styles.brandingText}>BOUNTY</Text>
        </View>

        {/* Header */}
        <View style={styles.header}>
          <MaterialIcons name="person-outline" size={56} color="#aad9b8" />
          <Text style={styles.title}>Choose Your Username</Text>
          <Text style={styles.subtitle}>
            This is how others will find you. Pick something unique and memorable.
          </Text>
        </View>

        {/* Input */}
        <View style={styles.inputSection}>
          <View style={styles.inputWrapper}>
            <Text style={styles.atSymbol}>@</Text>
            <TextInput
              style={styles.input}
              value={username}
              onChangeText={(text) => setUsername(text.toLowerCase())}
              placeholder="username"
              placeholderTextColor="rgba(255,255,255,0.4)"
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
            />
            {checking && (
              <ActivityIndicator size="small" color="#aad9b8" style={styles.indicator} />
            )}
            {!checking && username && isValid && (
              <MaterialIcons name="check-circle" size={24} color="#008e2a" style={styles.indicator} />
            )}
          </View>
          
          {/* Error message */}
          {error && (
            <View style={styles.errorContainer}>
              <MaterialIcons name="error-outline" size={16} color="#ef4444" />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}
          
          {/* Requirements */}
          <View style={styles.requirements}>
            <Text style={styles.requirementTitle}>Requirements:</Text>
            <Text style={styles.requirement}>• 3-20 characters</Text>
            <Text style={styles.requirement}>• Lowercase letters, numbers, and underscores only</Text>
            <Text style={styles.requirement}>• Must be unique</Text>
          </View>
        </View>

        {/* Legal acceptance */}
        <View style={styles.legalBox}>
          <TouchableOpacity
            style={styles.checkboxRow}
            onPress={() => setAccepted(!accepted)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: accepted }}
            accessibilityLabel="Accept terms and privacy policy"
          >
            <MaterialIcons name={accepted ? 'check-box' : 'check-box-outline-blank'} size={22} color="#aad9b8" />
            <Text style={styles.legalText}>I agree to the</Text>
            <TouchableOpacity 
              onPress={() => setLegalModal('terms')}
              accessibilityRole="link"
              accessibilityLabel="View Terms of Service"
            >
              <Text style={styles.linkText}> Terms of Service</Text>
            </TouchableOpacity>
            <Text style={styles.legalText}> and</Text>
            <TouchableOpacity 
              onPress={() => setLegalModal('privacy')}
              accessibilityRole="link"
              accessibilityLabel="View Privacy Policy"
            >
              <Text style={styles.linkText}> Privacy Policy</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </View>

        {/* Next Button */}
        <TouchableOpacity
          style={[styles.nextButton, (!isValid || checking || !accepted) && styles.nextButtonDisabled]}
          onPress={handleNext}
          disabled={!isValid || checking || !accepted}
        >
          <Text style={styles.nextButtonText}>
            {checking ? 'Checking...' : 'Next'}
          </Text>
          <MaterialIcons name="arrow-forward" size={20} color="#052e1b" />
        </TouchableOpacity>

        {/* Progress indicator */}
        <View style={styles.progressContainer}>
          <View style={[styles.progressDot, styles.progressDotActive]} />
          <View style={styles.progressDot} />
          <View style={styles.progressDot} />
          <View style={styles.progressDot} />
        </View>
      </View>

      {/* Legal Modal */}
      {renderLegalModal()}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#008e2a',
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
  },
  brandingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 8,
    paddingBottom: 8,
  },
  brandingText: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#ffffff',
    letterSpacing: 3,
    marginLeft: 8,
  },
  header: {
    alignItems: 'center',
    marginTop: 16,
    marginBottom: 32,
  },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#ffffff',
    marginTop: 12,
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.8)',
    textAlign: 'center',
    lineHeight: 22,
    paddingHorizontal: 16,
  },
  legalBox: {
    backgroundColor: 'rgba(5,46,27,0.5)',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(167,243,208,0.3)',
    marginBottom: 20,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  legalText: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
  },
  linkText: {
    color: '#aad9b8',
    textDecorationLine: 'underline',
    fontSize: 13,
    fontWeight: '600',
  },
  inputSection: {
    marginBottom: 24,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(5,46,27,0.5)',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 4,
    borderWidth: 2,
    borderColor: 'rgba(167,243,208,0.3)',
  },
  atSymbol: {
    fontSize: 24,
    color: '#aad9b8',
    fontWeight: '600',
    marginRight: 4,
  },
  input: {
    flex: 1,
    fontSize: 20,
    color: '#ffffff',
    paddingVertical: 14,
    fontWeight: '500',
  },
  indicator: {
    marginLeft: 8,
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    paddingHorizontal: 4,
  },
  errorText: {
    color: '#ef4444',
    fontSize: 14,
    marginLeft: 6,
  },
  requirements: {
    marginTop: 12,
    paddingHorizontal: 4,
  },
  requirementTitle: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 6,
  },
  requirement: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    lineHeight: 20,
  },
  nextButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#aad9b8',
    paddingVertical: 16,
    borderRadius: 999,
    marginBottom: 20,
    gap: 8,
  },
  nextButtonDisabled: {
    backgroundColor: 'rgba(167,243,208,0.3)',
  },
  nextButtonText: {
    color: '#052e1b',
    fontSize: 18,
    fontWeight: 'bold',
  },
  progressContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    paddingTop: 8,
  },
  progressDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  progressDotActive: {
    backgroundColor: '#aad9b8',
  },
  // Modal styles
  modalContainer: {
    flex: 1,
    backgroundColor: '#008e2a',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(167,243,208,0.2)',
  },
  modalTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: 'bold',
    color: '#ffffff',
    marginLeft: 12,
  },
  modalCloseButton: {
    padding: 4,
  },
  modalScroll: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  modalParagraph: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 14,
    lineHeight: 22,
    marginBottom: 12,
  },
});
