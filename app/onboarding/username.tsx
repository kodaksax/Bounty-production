/**
 * Username Onboarding Screen
 * First step: collect unique username (required)
 */

import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { validateUsername, isUsernameUnique } from '../../lib/services/userProfile';
import { useUserProfile } from '../../hooks/useUserProfile';

export default function UsernameScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { profile, updateProfile } = useUserProfile();
  
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [isValid, setIsValid] = useState(false);

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
        setError(validation.error);
        setIsValid(false);
        return;
      }

      // Uniqueness check (debounced)
      setChecking(true);
      setError(null);
      
      // Debounce
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
    if (!isValid || checking) return;

    // Save username to profile
    const result = await updateProfile({ 
      username,
      displayName: profile?.displayName,
      avatar: profile?.avatar,
      location: profile?.location,
      phone: profile?.phone,
    });

    if (result.success) {
      router.push('/onboarding/details');
    } else {
      setError(result.error || 'Failed to save username');
    }
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
          <MaterialIcons name="person-outline" size={64} color="#a7f3d0" />
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

        {/* Next Button */}
        <TouchableOpacity
          style={[styles.nextButton, (!isValid || checking) && styles.nextButtonDisabled]}
          onPress={handleNext}
          disabled={!isValid || checking}
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
    marginTop: 40,
    marginBottom: 40,
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
    marginBottom: 32,
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
    marginTop: 16,
    paddingHorizontal: 4,
  },
  requirementTitle: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
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
    marginBottom: 24,
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
