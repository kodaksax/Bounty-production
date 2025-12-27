import React from 'react'
import { Button } from 'react-native'
import { supabase } from '../../lib/supabase'
import { withTimeout } from '../../lib/utils/withTimeout'

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
  } catch (timeoutError) {
    console.error('Sign out timed out:', timeoutError)
    // Force clear local session even if server signout fails
    try {
      await supabase.auth.signOut({ scope: 'local' })
    } catch (e) {
      console.error('Failed to clear local session:', e)
    }
  }
}

export default function SignOutButton() {
  return <Button title="Sign out" onPress={onSignOutButtonPress} />
}