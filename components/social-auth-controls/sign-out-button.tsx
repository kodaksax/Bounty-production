import React from 'react'
import { Alert, Button } from 'react-native'
import { supabase } from '../../lib/supabase'
import { withTimeout } from '../../lib/utils/withTimeout'
import { clearRememberMePreference } from '../../lib/auth-session-storage'

async function onSignOutButtonPress() {
  try {
    // OPTIMIZATION: Sign out locally first for immediate response
    // This provides instant feedback to the user
    await supabase.auth.signOut({ scope: 'local' })
    
    // OPTIMIZATION: Run cleanup operations in background (non-blocking)
    Promise.all([
      // Clear remember me preference
      clearRememberMePreference(),
      // Attempt server sign-out (best-effort)
      supabase.auth.signOut().catch(e => 
        console.error('[SignOut] Background server signout failed (non-critical)', e)
      )
    ]).catch(e => {
      console.error('[SignOut] Background cleanup errors (non-critical)', e);
    });
  } catch (signoutError) {
    console.error('[SignOut] Local sign out failed:', signoutError)
    // If local sign-out fails, show error to user
    Alert.alert(
      'Sign Out Error',
      'Unable to sign out. Please close and restart the app.',
      [{ text: 'OK' }]
    )
  }
}

export default function SignOutButton() {
  return <Button title="Sign out" onPress={onSignOutButtonPress} />
}