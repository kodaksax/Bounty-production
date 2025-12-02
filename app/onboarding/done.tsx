/**
 * Done Onboarding Screen
 * Final step: confirm completion and navigate to app
 * Shows profile summary including skills, bio, title from onboarding
 */

import { MaterialIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Image, Animated,
    StyleSheet,
    Text,
    TouchableOpacity,
    View, } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthProfile } from '../../hooks/useAuthProfile';
import { useNormalizedProfile } from '../../hooks/useNormalizedProfile';
import { useUserProfile } from '../../hooks/useUserProfile';
import { useOnboarding } from '../../lib/context/onboarding-context';
import { supabase } from '../../lib/supabase';

const ONBOARDING_COMPLETE_KEY = '@bounty_onboarding_completed';

export default function DoneScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { profile: localProfile } = useUserProfile();
  const { profile: normalized } = useNormalizedProfile();
  const { userId } = useAuthProfile();
  const { data: onboardingData, clearData: clearOnboardingData } = useOnboarding();
  
  // Use onboarding data primarily, fallback to normalized/local
  const displayUsername = onboardingData.username || normalized?.username || (localProfile as any)?.username;
  const displayName = onboardingData.displayName || normalized?.name || (localProfile as any)?.displayName;
  const displayTitle = onboardingData.title || normalized?.title || (localProfile as any)?.title;
  const displayBio = onboardingData.bio || normalized?.bio || (localProfile as any)?.bio;
  const displayLocation = onboardingData.location || normalized?.location || (localProfile as any)?.location;
  const displaySkills = onboardingData.skills.length > 0 
    ? onboardingData.skills 
    : normalized?.skills || (localProfile as any)?.skills || [];
  const hasPhone = !!onboardingData.phone || !!(normalized?._raw && (normalized as any)._raw.phone) || !!(localProfile as any)?.phone;
  
  const [scaleAnim] = useState(new Animated.Value(0));
  const [fadeAnim] = useState(new Animated.Value(0));

  useEffect(() => {
    // Animate check mark
    Animated.sequence([
      Animated.spring(scaleAnim, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();
    
    // Mark onboarding as complete in AsyncStorage
    const markComplete = async () => {
      try {
        await AsyncStorage.setItem(ONBOARDING_COMPLETE_KEY, 'true');
        
        // Also update the Supabase profile to mark onboarding as complete
        if (userId) {
          const { error } = await supabase
            .from('profiles')
            .update({ onboarding_completed: true })
            .eq('id', userId);
            
          if (error) {
            console.error('[Onboarding] Error marking onboarding as complete in Supabase:', error);
          } else {
            console.log('[Onboarding] Successfully marked onboarding as complete for user:', userId);
          }
        }
      } catch (error) {
        console.error('[Onboarding] Error marking onboarding as complete:', error);
      }
    };
    
    markComplete();
  }, [scaleAnim, fadeAnim, userId]);

  const handleContinue = async () => {
    // Clear onboarding data from context as it's now saved to profile
    await clearOnboardingData();
    // Navigate to the Bounty app dashboard
    router.replace('/tabs/bounty-app');
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom + 100 }]}>
      {/* Branding Header */}
      <View style={styles.brandingHeader}>
        <MaterialIcons name="gps-fixed" size={24} color="#a7f3d0" />
        <Text style={styles.brandingText}>BOUNTY</Text>
      </View>

      {/* Success Animation */}
      <View style={styles.content}>
        <Animated.View
          style={[
            styles.checkCircle,
            {
              transform: [{ scale: scaleAnim }],
            },
          ]}
        >
          <MaterialIcons name="check" size={72} color="#052e1b" />
        </Animated.View>

        <Animated.View style={{ opacity: fadeAnim, alignItems: 'center', width: '100%' }}>
          <Text style={styles.title}>You're All Set!</Text>
          <Text style={styles.subtitle}>
            Welcome to Bounty, @{displayUsername || 'user'}!
          </Text>
          
          <View style={styles.summaryCard}>
            <Text style={styles.summaryTitle}>Your Profile Summary</Text>
            
            <View style={styles.summaryItem}>
              <MaterialIcons name="person" size={18} color="#a7f3d0" />
              <Text style={styles.summaryLabel}>Username</Text>
              <Text style={styles.summaryValue}>@{displayUsername}</Text>
            </View>
            
            {displayName && (
              <View style={styles.summaryItem}>
                <MaterialIcons name="badge" size={18} color="#a7f3d0" />
                <Text style={styles.summaryLabel}>Name</Text>
                <Text style={styles.summaryValue}>{displayName}</Text>
              </View>
            )}

            {displayTitle && (
              <View style={styles.summaryItem}>
                <MaterialIcons name="work" size={18} color="#a7f3d0" />
                <Text style={styles.summaryLabel}>Title</Text>
                <Text style={styles.summaryValue}>{displayTitle}</Text>
              </View>
            )}
            
            {displayLocation && (
              <View style={styles.summaryItem}>
                <MaterialIcons name="location-on" size={18} color="#a7f3d0" />
                <Text style={styles.summaryLabel}>Location</Text>
                <Text style={styles.summaryValue}>{displayLocation}</Text>
              </View>
            )}

            {displayBio && (
              <View style={styles.summaryItemColumn}>
                <View style={styles.summaryItemRow}>
                  <MaterialIcons name="info-outline" size={18} color="#a7f3d0" />
                  <Text style={styles.summaryLabel}>Bio</Text>
                </View>
                <Text style={styles.summaryBio}>{displayBio}</Text>
              </View>
            )}

            {displaySkills.length > 0 && (
              <View style={styles.summaryItemColumn}>
                <View style={styles.summaryItemRow}>
                  <MaterialIcons name="star" size={18} color="#a7f3d0" />
                  <Text style={styles.summaryLabel}>Skills</Text>
                </View>
                <View style={styles.skillsRow}>
                  {displaySkills.slice(0, 4).map((skill: string, index: number) => (
                    <View key={index} style={styles.skillBadge}>
                      <Text style={styles.skillBadgeText}>{skill}</Text>
                    </View>
                  ))}
                  {displaySkills.length > 4 && (
                    <Text style={styles.moreSkills}>+{displaySkills.length - 4} more</Text>
                  )}
                </View>
              </View>
            )}
            
            {hasPhone && (
              <View style={styles.summaryItem}>
                <MaterialIcons name="phone" size={18} color="#a7f3d0" />
                <Text style={styles.summaryLabel}>Phone</Text>
                <Text style={styles.summaryValue}>✓ Added (private)</Text>
              </View>
            )}
          </View>

          <Text style={styles.infoText}>
            You can update your profile anytime from the Profile tab
          </Text>
        </Animated.View>
      </View>

      {/* Continue Button */}
      <Animated.View style={{ opacity: fadeAnim }}>
        <TouchableOpacity style={styles.continueButton} onPress={handleContinue}>
          <Text style={styles.continueButtonText}>Start Exploring</Text>
          <MaterialIcons name="arrow-forward" size={20} color="#052e1b" />
        </TouchableOpacity>
      </Animated.View>

      {/* Progress indicator */}
      <View style={styles.progressContainer}>
        <View style={styles.progressDot} />
        <View style={styles.progressDot} />
        <View style={styles.progressDot} />
        <View style={[styles.progressDot, styles.progressDotActive]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#059669',
    paddingHorizontal: 24,
  },
  brandingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  brandingText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#ffffff',
    letterSpacing: 2,
    marginLeft: 8,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#a7f3d0',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: 'rgba(255,255,255,0.9)',
    marginBottom: 24,
  },
  summaryCard: {
    backgroundColor: 'rgba(5,46,27,0.5)',
    borderRadius: 16,
    padding: 16,
    width: '100%',
    borderWidth: 2,
    borderColor: 'rgba(167,243,208,0.3)',
    marginBottom: 16,
  },
  summaryTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#a7f3d0',
    marginBottom: 12,
    textAlign: 'center',
  },
  summaryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  summaryItemColumn: {
    marginBottom: 10,
  },
  summaryItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  summaryLabel: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    marginLeft: 8,
    minWidth: 70,
  },
  summaryValue: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '500',
    flex: 1,
  },
  summaryBio: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 12,
    lineHeight: 18,
    marginLeft: 26,
  },
  skillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginLeft: 26,
  },
  skillBadge: {
    backgroundColor: 'rgba(167,243,208,0.2)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  skillBadgeText: {
    color: '#a7f3d0',
    fontSize: 11,
    fontWeight: '500',
  },
  moreSkills: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 11,
    alignSelf: 'center',
  },
  infoText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  continueButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#a7f3d0',
    paddingVertical: 16,
    borderRadius: 999,
    gap: 8,
    marginBottom: 24,
  },
  continueButtonText: {
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
