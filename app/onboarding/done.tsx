/**
 * Done Onboarding Screen
 * Final step: confirm completion and navigate to Profile
 */

import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
    Animated,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNormalizedProfile } from '../../hooks/useNormalizedProfile';
import { useUserProfile } from '../../hooks/useUserProfile';

export default function DoneScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { profile: localProfile } = useUserProfile();
  const { profile: normalized } = useNormalizedProfile();
  const displayProfile = normalized || (localProfile ? { username: localProfile.username, name: (localProfile as any).displayName || undefined, _raw: localProfile } : null as any);
  
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
  }, []);

  const handleContinue = () => {
    // Navigate to the Bounty app dashboard
    router.replace('/tabs/bounty-app');
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom + 160 }]}>
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
          <MaterialIcons name="check" size={80} color="#052e1b" />
        </Animated.View>

        <Animated.View style={{ opacity: fadeAnim, alignItems: 'center' }}>
          <Text style={styles.title}>All Set!</Text>
          <Text style={styles.subtitle}>
            Welcome to Bounty, @{displayProfile?.username || 'user'}!
          </Text>
          
          <View style={styles.summaryCard}>
            <Text style={styles.summaryTitle}>Your Profile</Text>
            
            <View style={styles.summaryItem}>
              <MaterialIcons name="person" size={20} color="#a7f3d0" />
              <Text style={styles.summaryLabel}>Username:</Text>
              <Text style={styles.summaryValue}>@{displayProfile?.username}</Text>
            </View>
            
            {displayProfile?.name && (
              <View style={styles.summaryItem}>
                <MaterialIcons name="badge" size={20} color="#a7f3d0" />
                <Text style={styles.summaryLabel}>Display Name:</Text>
                <Text style={styles.summaryValue}>{displayProfile?.name}</Text>
              </View>
            )}
            
            {displayProfile?._raw?.location && (
              <View style={styles.summaryItem}>
                <MaterialIcons name="location-on" size={20} color="#a7f3d0" />
                <Text style={styles.summaryLabel}>Location:</Text>
                <Text style={styles.summaryValue}>{displayProfile?._raw?.location}</Text>
              </View>
            )}
            
            {displayProfile?._raw?.phone && (
              <View style={styles.summaryItem}>
                <MaterialIcons name="phone" size={20} color="#a7f3d0" />
                <Text style={styles.summaryLabel}>Phone:</Text>
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
          <Text style={styles.continueButtonText}>Continue to Bounty</Text>
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
    justifyContent: 'space-between',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 40,
  },
  checkCircle: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: '#a7f3d0',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 32,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 18,
    color: 'rgba(255,255,255,0.9)',
    marginBottom: 32,
  },
  summaryCard: {
    backgroundColor: 'rgba(5,46,27,0.5)',
    borderRadius: 16,
    padding: 20,
    width: '100%',
    borderWidth: 2,
    borderColor: 'rgba(167,243,208,0.3)',
    marginBottom: 20,
  },
  summaryTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#a7f3d0',
    marginBottom: 16,
    textAlign: 'center',
  },
  summaryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  summaryLabel: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
    marginLeft: 8,
    minWidth: 100,
  },
  summaryValue: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
  },
  infoText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
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
