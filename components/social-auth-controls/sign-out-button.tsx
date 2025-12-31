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
    // Each operation has its own error handling so failures don't cascade
    // Using void to explicitly indicate fire-and-forget behavior
    void Promise.all([
      // Clear remember me preference
      clearRememberMePreference().catch(e => 
        console.error('[SignOut] Failed to clear remember me preference', e)
      ),
      // Attempt server sign-out in background (best-effort)
      // Note: This calls signOut() without scope, which will attempt both local and server.
      // Since local is already cleared, this effectively only does server-side cleanup.
      supabase.auth.signOut().catch(e => 
        console.error('[SignOut] Background server signout failed (non-critical)', e)
      )
    ]).catch(e => {
      // This catch is only reached if the Promise.all itself fails (unlikely)
      console.error('[SignOut] Background cleanup encountered unexpected error', e);
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