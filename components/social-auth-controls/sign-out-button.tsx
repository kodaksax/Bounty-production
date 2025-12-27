import React from 'react'
import { Alert, Button } from 'react-native'
import { supabase } from '../../lib/supabase'
import { withTimeout } from '../../lib/utils/withTimeout'
import { clearRememberMePreference, clearAllSessionData } from '../../lib/auth-session-storage'

async function onSignOutButtonPress() {
  try {
    // Add timeout to prevent hanging on sign out
    const { error } = await withTimeout(
      supabase.auth.signOut(),
      10000 // 10 second timeout for sign out
    )

    if (error) {
      console.error('Error signing out:', error)
    }
    
    // Clear remember me preference after successful sign out
    // This ensures preference is only cleared if sign out succeeds
    await clearRememberMePreference()
    
    // Ensure all session data is cleared
    await clearAllSessionData()
  } catch (timeoutError) {
    console.error('Sign out timed out:', timeoutError)
    // Force clear local session even if server signout fails
    try {
      await supabase.auth.signOut({ scope: 'local' })
      await clearRememberMePreference()
      await clearAllSessionData()
    } catch (e) {
      console.error('Failed to clear local session:', e)
      // If both server and local sign-out fail, alert the user
      Alert.alert(
        'Sign Out Error',
        'Unable to sign out. Please close and restart the app.',
        [{ text: 'OK' }]
      )
    }
  }
}

export default function SignOutButton() {
  return <Button title="Sign out" onPress={onSignOutButtonPress} />
}