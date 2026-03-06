/**
 * Username Onboarding Screen
 * First step: collect unique username (required)
 * Features: Bounty branding, state persistence via context, navigation to legal docs
 */

import { MaterialIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Keyboard,
    KeyboardAvoidingView,
    Platform,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    TouchableWithoutFeedback,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BrandingLogo } from '../../components/ui/branding-logo';
import { useAuthProfile } from '../../hooks/useAuthProfile';
import { useNormalizedProfile } from '../../hooks/useNormalizedProfile';
import { useUserProfile } from '../../hooks/useUserProfile';
import { useOnboarding } from '../../lib/context/onboarding-context';
import { isUsernameUnique, validateUsername } from '../../lib/services/userProfile';
import { supabase } from '../../lib/supabase';

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
  const [submitTick, setSubmitTick] = useState(0);
  const submittingRef = useRef(false);

  // Sync from context on mount
  useEffect(() => {
    if (onboardingData.username && onboardingData.username !== username) {
      setUsername(onboardingData.username);
    }
    if (onboardingData.accepted !== accepted) {
      setAccepted(onboardingData.accepted);
    }
    // Cleanup guard on unmount: ensure submitting ref is cleared so retries remain possible
    return () => {
      if (submittingRef.current) {
        submittingRef.current = false;
        setSubmitTick((t) => t + 1);
      }
    };
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

  // Validate username on change (debounced uniqueness check)
  useEffect(() => {
    if (!username) {
      setError(null);
      setIsValid(false);
      setChecking(false);
      return;
    }

    // Format validation (synchronous — no debounce needed)
    const validation = validateUsername(username);
    if (!validation.valid) {
      setError(validation.error ?? null);
      setIsValid(false);
      setChecking(false);
      return;
    }

    // Skip uniqueness check until userId is resolved
    if (!userId) {
      setChecking(false);
      return;
    }

    // Cancellation guard: prevents stale in-flight checks from updating state
    let cancelled = false;

    // Debounced uniqueness check
    setChecking(true);
    setError(null);

    const timer = setTimeout(async () => {
      try {
        const unique = await isUsernameUnique(username, userId);
        if (cancelled) return;
        if (!unique) {
          setError('Username is already taken');
          setIsValid(false);
        } else {
          setError(null);
          setIsValid(true);
        }
      } catch {
        if (cancelled) return;
        // Optimistic — allow if check fails
        setIsValid(true);
      } finally {
        if (!cancelled) setChecking(false);
      }
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [username, userId]);

  const handleNext = async () => {
    // Validate prerequisites - guard against disabled state
    if (!isValid || checking || !accepted) {
      return;
    }

    // Check if user is authenticated
    if (!userId) {
      setError('Please sign in to continue. Your session may have expired.');
      return;
    }

    // Prevent duplicate submissions / navigation (use ref as immediate guard)
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitTick((t) => t + 1);

    try {
      // Fire-and-forget: persist legal acceptance (non-blocking)
      AsyncStorage.setItem('BE:acceptedLegal', 'true').catch(() => {});

      // Fire-and-forget: save to local profile (non-blocking — Supabase is source of truth)
      const localProfileData = {
        username,
        displayName: normalized?.name || localProfile?.displayName,
        avatar: normalized?.avatar || localProfile?.avatar,
        location: (normalized?._raw && (normalized as any)._raw.location) || localProfile?.location,
        phone: (normalized?._raw && (normalized as any)._raw.phone) || localProfile?.phone,
      };
      updateProfile(localProfileData).catch((localError) => {
        console.error('[onboarding] Local profile save error:', localError);
      });

      // Upsert the username into the profiles table.
      // upsert() handles both the "profile already exists" (UPDATE path) and the
      // rare "profile row missing" (INSERT path) cases in one round-trip.
      // onConflict:'id' ensures that a conflict on the primary key triggers an
      // update rather than an error, while a conflict on the UNIQUE username
      // column (different user already owns it) still surfaces as error 23505.
      // Wrapped in Promise.race so a non-responsive network surfaces quickly
      // instead of blocking the user indefinitely.
      const SAVE_TIMEOUT_MS = 10000;
      let saveTimerId: ReturnType<typeof setTimeout> | undefined;

      class SaveTimeoutError extends Error {
        constructor() { super('SaveTimeoutError'); this.name = 'SaveTimeoutError'; }
      }

      const supabaseResult = await Promise.race([
        supabase
          .from('profiles')
          .upsert(
            { id: userId, username, onboarding_completed: false },
            { onConflict: 'id' },
          )
          .select('id, username')
          .single(),
        new Promise<never>((_, reject) => {
          saveTimerId = setTimeout(
            () => reject(new SaveTimeoutError()),
            SAVE_TIMEOUT_MS,
          );
        }),
      ]).finally(() => clearTimeout(saveTimerId));

      // Check Supabase result
      if (supabaseResult.error) {
        if (supabaseResult.error.code === '23505') {
          setError('This username is already taken. Please choose another.');
          submittingRef.current = false;
          setSubmitTick((t) => t + 1);
          return;
        }
        // For other Supabase errors log and fall through to navigate anyway —
        // the username can be retried from profile settings.
        console.error('[onboarding] Supabase upsert error:', supabaseResult.error);
      }

      // Fire-and-forget: sync auth profile cache (non-blocking)
      updateAuthProfile({ username }).catch((authError) => {
        console.error('[onboarding] Error updating auth profile:', authError);
      });

      // Navigate to next onboarding step
      try {
        router.push('/onboarding/details');
      } catch (navError) {
        console.error('[onboarding] Navigation error:', navError);
        setError('Navigation failed. Please try again.');
      } finally {
        if (submittingRef.current) {
          submittingRef.current = false;
          setSubmitTick((t) => t + 1);
        }
      }
    } catch (err) {
      console.error('[onboarding] Error:', err);
      if (err instanceof Error && err.name === 'SaveTimeoutError') {
        // Network too slow — save locally and let the user continue onboarding.
        // The username will be synced on the next successful Supabase operation.
        console.warn('[onboarding] Save timed out — proceeding with local save only');
        updateAuthProfile({ username }).catch((authError) => {
          console.error('[onboarding] Error updating auth profile after timeout:', authError);
        });
        try {
          router.push('/onboarding/details');
        } catch (navError) {
          console.error('[onboarding] Navigation error after timeout:', navError);
          setError('Navigation failed. Please try again.');
        } finally {
          submittingRef.current = false;
          setSubmitTick((t) => t + 1);
        }
      } else {
        setError(err instanceof Error ? err.message : 'Failed to save username. Please try again.');
        submittingRef.current = false;
        setSubmitTick((t) => t + 1);
      }
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <TouchableWithoutFeedback onPress={() => Keyboard.dismiss()}>
        <View style={[styles.content, { paddingBottom: insets.bottom + 40 }]}>
        {/* Branding Header */}
        <View style={styles.brandingHeader}>
          <BrandingLogo size="medium" />
        </View>

        {/* Header */}
        <View style={styles.header}>
          <MaterialIcons name="person-outline" size={56} color="#a7f3d0" />
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
              <ActivityIndicator size="small" color="#a7f3d0" style={styles.indicator} />
            )}
            {!checking && username && isValid && (
              <MaterialIcons name="check-circle" size={24} color="#10b981" style={styles.indicator} />
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
          <View style={styles.checkboxRow}>
            <TouchableOpacity
              onPress={() => setAccepted(!accepted)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: accepted }}
              accessibilityLabel="Accept terms and privacy policy"
              style={styles.checkboxButton}
            >
              <MaterialIcons name={accepted ? 'check-box' : 'check-box-outline-blank'} size={22} color="#a7f3d0" />
            </TouchableOpacity>
            <Text style={styles.legalText}>I agree to the</Text>
            <TouchableOpacity 
              onPress={() => router.push('/legal/terms')}
              accessibilityRole="link"
              accessibilityLabel="View Terms of Service"
            >
              <Text style={styles.linkText}> Terms of Service</Text>
            </TouchableOpacity>
            <Text style={styles.legalText}> and</Text>
            <TouchableOpacity 
              onPress={() => router.push('/legal/privacy')}
              accessibilityRole="link"
              accessibilityLabel="View Privacy Policy"
            >
              <Text style={styles.linkText}> Privacy Policy</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Next Button */}
        {(() => {
          // Depend on submitTick so that updates to it trigger re-renders that reflect the latest submittingRef state
          const submitting = submittingRef.current && submitTick >= 0;
          return (
            <TouchableOpacity
              style={[
                styles.nextButton,
                (!isValid || checking || !accepted || submitting) && styles.nextButtonDisabled,
              ]}
              onPress={handleNext}
              disabled={!isValid || checking || !accepted || submitting}
            >
              {submitting ? (
                <ActivityIndicator size="small" color="#052e1b" style={{ marginRight: 8 }} />
              ) : null}
              <Text style={styles.nextButtonText}>
                {submitting ? 'Saving...' : checking ? 'Checking...' : 'Next'}
              </Text>
              <MaterialIcons name="arrow-forward" size={20} color="#052e1b" />
            </TouchableOpacity>
          );
        })()}

        {/* Progress indicator */}
        <View style={styles.progressContainer}>
          <View style={[styles.progressDot, styles.progressDotActive]} />
          <View style={styles.progressDot} />
          <View style={styles.progressDot} />
          <View style={styles.progressDot} />
        </View>
        </View>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#059669',
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
  checkboxButton: {
    marginRight: 4,
  },
  legalText: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
  },
  linkText: {
    color: '#a7f3d0',
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
    color: '#a7f3d0',
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
    backgroundColor: '#a7f3d0',
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
    backgroundColor: '#a7f3d0',
  },
});
