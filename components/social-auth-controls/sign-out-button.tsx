import React from 'react'
import { Alert, Button } from 'react-native'
import { supabase } from '../../lib/supabase'
import { withTimeout } from '../../lib/utils/withTimeout'
import { clearRememberMePreference } from '../../lib/auth-session-storage'

async function onSignOutButtonPress() {
  try {
    // Let Supabase SDK handle network timeouts and retry logic
    const { error } = await supabase.auth.signOut()

    if (error) {
      console.error('Error signing out:', error)
    }
  } catch (signoutError) {
    console.error('Sign out failed:', signoutError)
    // Force clear local session even if server signout fails
    try {
      await supabase.auth.signOut({ scope: 'local' })
      await clearRememberMePreference()
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