/**
 * Test utilities for profile management
 * Use these to simulate new user scenarios for testing onboarding
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Clear all profile data to simulate a new user
 * Useful for testing onboarding flow
 */
export async function clearProfileForTesting(): Promise<void> {
  try {
    await AsyncStorage.removeItem('BE:userProfile');
    await AsyncStorage.removeItem('BE:allProfiles');
  } catch (error) {
    console.error('[TestUtils] Error clearing profile:', error);
  }
}

/**
 * Set a test profile to simulate a complete user
 * Useful for skipping onboarding in development
 */
export async function setTestProfile(): Promise<void> {
  try {
    const testProfile = {
      username: 'testuser',
      displayName: 'Test User',
      location: 'San Francisco, CA',
      phone: '+14155551234',
    };
    
    await AsyncStorage.setItem('BE:userProfile', JSON.stringify(testProfile));
    
    const profiles = { 'current-user': testProfile };
    await AsyncStorage.setItem('BE:allProfiles', JSON.stringify(profiles));
    
  } catch (error) {
    console.error('[TestUtils] Error setting test profile:', error);
  }
}

// For React Native DevMenu integration
if (__DEV__) {
  // Make these available globally in dev mode for easy access from console
  (global as any).clearProfileForTesting = clearProfileForTesting;
  (global as any).setTestProfile = setTestProfile;
  // Test utilities available: clearProfileForTesting(), setTestProfile()
}
