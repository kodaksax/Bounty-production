/**
 * Account Deletion Service
 * Handles secure account deletion and data cleanup
 * 
 * NOTE: As of migration 20251117_safe_user_deletion.sql, the database automatically
 * handles cleanup via a trigger function that:
 * - Archives active bounties
 * - Refunds escrowed funds
 * - Releases hunter assignments
 * - Rejects pending applications
 * - Cleans up notifications
 * 
 * This means users can be safely deleted even with active bounties, escrow, etc.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApiBaseUrl } from '../config/api';
import { supabase } from '../supabase';
import { clearRememberMePreference } from '../auth-session-storage';

/**
 * Clear all local storage data for the user
 * This should be called after successful account deletion to ensure
 * a fresh state for any future sign-ups with the same device
 */
async function clearLocalUserData(): Promise<void> {
  try {
    // Clear all profile and onboarding related keys
    const keysToRemove = [
      '@bounty_onboarding_complete',
      '@bounty_onboarding_completed',
      'BE:userProfile',
      'BE:allProfiles',
      'BE:acceptedLegal',
      'profileData',
      'profileSkills',
    ];
    
    // Also clear any user-specific keys (those with userId in them)
    const allKeys = await AsyncStorage.getAllKeys();
    const userSpecificKeys = allKeys.filter(key => 
      key.includes('BE:userProfile:') || 
      key.includes('profileData:') || 
      key.includes('profileSkills:')
    );
    
    await AsyncStorage.multiRemove([...keysToRemove, ...userSpecificKeys]);
  } catch (error) {
    console.error('[AccountDeletion] Error clearing local data:', error);
  }
}

/**
 * Get information about what will happen when user deletes their account
 * This provides transparency to users about the cleanup process
 */
async function getAccountDeletionInfo(userId: string): Promise<{
  activeBounties: number;
  workingOnBounties: number;
  escrowAmount: number;
  pendingApplications: number;
}> {
  let activeBounties = 0;
  let workingOnBounties = 0;
  let escrowAmount = 0;
  let pendingApplications = 0;

  // Count active bounties created by user
  try {
    const { count, error } = await supabase
      .from('bounties')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .in('status', ['open', 'in_progress']);
    
    if (!error && count !== null) {
      activeBounties = count;
    }
  } catch (e) {
    console.error('[AccountDeletion] Failed to count created bounties:', e);
  }

  // Count bounties user is working on
  try {
    const { count, error } = await supabase
      .from('bounties')
      .select('id', { count: 'exact', head: true })
      .eq('accepted_by', userId)
      .eq('status', 'in_progress');
    
    if (!error && count !== null) {
      workingOnBounties = count;
    }
  } catch (e) {
    console.error('[AccountDeletion] Failed to count accepted bounties:', e);
  }

  // Calculate escrow amount
  try {
    const { data: transactions, error } = await supabase
      .from('wallet_transactions')
      .select('amount')
      .eq('user_id', userId)
      .eq('type', 'escrow')
      .eq('status', 'pending');
    
    if (!error && transactions) {
      escrowAmount = transactions.reduce((sum: number, tx: any) => sum + (tx.amount || 0), 0);
    }
  } catch (e) {
    console.error('[AccountDeletion] Failed to calculate escrow:', e);
  }

  // Count pending applications
  try {
    const { count, error } = await supabase
      .from('bounty_requests')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'pending');
    
    if (!error && count !== null) {
      pendingApplications = count;
    }
  } catch (e) {
    console.error('[AccountDeletion] Failed to count applications:', e);
  }

  return {
    activeBounties,
    workingOnBounties,
    escrowAmount,
    pendingApplications,
  };
}

/**
 * Delete user account and all associated data
 * 
 * The database trigger (handle_user_deletion_cleanup) automatically handles:
 * - Archiving active bounties
 * - Refunding escrowed funds
 * - Releasing hunter assignments
 * - Rejecting pending applications
 * - Cleaning up notifications and personal data
 * 
 * @returns Promise that resolves when deletion completes
 */
export async function deleteUserAccount(): Promise<{ 
  success: boolean; 
  message: string;
  info?: {
    activeBounties: number;
    workingOnBounties: number;
    escrowAmount: number;
    pendingApplications: number;
  };
}> {
  try {
    // First try to get the session which includes user info
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    
    if (sessionError) {
      console.error('[AccountDeletion] Session error:', sessionError);
      return {
        success: false,
        message: 'Failed to verify authentication. Please try signing out and signing in again.',
      };
    }
    
    if (!session) {
      return {
        success: false,
        message: 'No active session found. Please sign in again to delete your account.',
      };
    }

    const userId = session.user.id;
    const accessToken = session.access_token;

    // Get information about what will be cleaned up
    const info = await getAccountDeletionInfo(userId);

    // Build informative message about what will happen
    const cleanupDetails: string[] = [];
    if (info.activeBounties > 0) {
      cleanupDetails.push(`${info.activeBounties} active bounty/bounties will be archived`);
    }
    if (info.workingOnBounties > 0) {
      cleanupDetails.push(`${info.workingOnBounties} bounty/bounties you're working on will be reopened`);
    }
    if (info.escrowAmount > 0) {
      cleanupDetails.push(`$${info.escrowAmount.toFixed(2)} in escrow will be refunded`);
    }
    if (info.pendingApplications > 0) {
      cleanupDetails.push(`${info.pendingApplications} pending application(s) will be rejected`);
    }

    // Call the backend API to delete the user
    // The backend has the service role key to properly delete from auth.users
    const apiBaseUrl = getApiBaseUrl(3001); // Use port 3001 for the api server (matches server.js)
    
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      try {
        controller.abort();
      } catch (abortErr) {
        console.error('[AccountDeletion] AbortController abort failed:', abortErr);
      }
    }, 30000);

    try {
      const response = await fetch(`${apiBaseUrl}/auth/delete-account`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          // Omit Content-Type to prevent Fastify empty JSON body error when no body is sent
        },
        // No body needed; server only relies on auth token. If you later need meta, send body: '{}'
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage;
        try {
          const errorJson = JSON.parse(errorText);
          errorMessage = errorJson.message || errorJson.error || 'Failed to delete account';
        } catch {
          errorMessage = errorText || 'Failed to delete account';
        }
        
        console.error('[AccountDeletion] API deletion failed:', {
          status: response.status,
          statusText: response.statusText,
          error: errorMessage
        });
        
        return {
          success: false,
          message: `Failed to delete account: ${errorMessage}`,
          info,
        };
      }

      const result = await response.json();

      if (!result.success) {
        console.error('[AccountDeletion] API deletion failed:', result);
        return {
          success: false,
          message: result.message || 'Failed to delete account',
          info,
        };
      }

      // Clear all local user data before signing out
      await clearLocalUserData();

      // Clear remember me preference
      await clearRememberMePreference();

      // Sign out the user after successful deletion
      // Note: supabase.auth.signOut() calls the storage adapter's removeItem,
      // which clears session data from secure storage automatically
      await supabase.auth.signOut();

      return {
        success: true,
        message: 'Account deleted successfully.\n\n' + 
                 (cleanupDetails.length > 0 ? 'The following actions were taken:\n- ' + cleanupDetails.join('\n- ') : ''),
        info,
      };
    } catch (fetchError: any) {
      clearTimeout(timeoutId);
      console.error('[AccountDeletion] Network error:', fetchError);
      
      // Provide more helpful error messages based on error type
      let errorMessage = 'Unable to connect to the server. Please check your internet connection and try again.';
      
      if (fetchError.name === 'AbortError') {
        errorMessage = 'Request timed out. Please check your internet connection and try again.';
      } else if (fetchError.message?.includes('Network request failed')) {
        errorMessage = 'Network error. Please ensure you have an active internet connection and the server is running.';
      }
      
      // Fallback: Try to delete profile directly if API is not available
      console.error('[AccountDeletion] API not available, attempting fallback...');
      
      try {
        // Pre-fallback cleanup sequence (best-effort, each step non-fatal):
        // 1. Delete completion submissions by this user (hunter)
        try {
          const { error: compErr } = await supabase
            .from('completion_submissions')
            .delete()
            .eq('hunter_id', userId);
          if (compErr) console.error('[AccountDeletion] Fallback completion_submissions cleanup failed (continuing):', compErr);
        } catch (e) {
          console.error('[AccountDeletion] Fallback completion_submissions cleanup threw (continuing):', e);
        }
        // 2. Delete bounty requests by this user (hunter applications)
        try {
          const { error: reqErr } = await supabase
            .from('bounty_requests')
            .delete()
            .eq('user_id', userId);
          if (reqErr) console.error('[AccountDeletion] Fallback bounty_requests cleanup failed (continuing):', reqErr);
        } catch (e) {
          console.error('[AccountDeletion] Fallback bounty_requests cleanup threw (continuing):', e);
        }
        // 3. Delete bounties created by this user to avoid NOT NULL poster_id violation
        try {
          const { error: bntyErr } = await supabase
            .from('bounties')
            .delete()
            .eq('poster_id', userId);
          if (bntyErr) console.error('[AccountDeletion] Fallback bounties cleanup failed (continuing):', bntyErr);
        } catch (e) {
          console.error('[AccountDeletion] Fallback bounties cleanup threw (continuing):', e);
        }
        // 4. Delete conversations created by this user, ensuring children removed first
        try {
          // Fetch conversation ids
          const { data: convs, error: convListErr } = await supabase
            .from('conversations')
            .select('id')
            .eq('created_by', userId);
          if (convListErr) {
            console.error('[AccountDeletion] Fallback conversations list failed (continuing):', convListErr);
          } else if (convs && convs.length > 0) {
            const ids = convs.map((c: any) => c.id);
            // Delete messages first
            const { error: msgErr } = await supabase
              .from('messages')
              .delete()
              .in('conversation_id', ids);
            if (msgErr) console.error('[AccountDeletion] Fallback messages deletion failed (continuing):', msgErr);
            // Delete participants
            const { error: partErr } = await supabase
              .from('conversation_participants')
              .delete()
              .in('conversation_id', ids);
            if (partErr) console.error('[AccountDeletion] Fallback participants deletion failed (continuing):', partErr);
            // Delete conversations
            const { error: convDelErr } = await supabase
              .from('conversations')
              .delete()
              .in('id', ids);
            if (convDelErr) console.error('[AccountDeletion] Fallback conversations deletion failed (continuing):', convDelErr);
          }
          // Remove any participant rows for this user in other conversations
          const { error: partUserErr } = await supabase
            .from('conversation_participants')
            .delete()
            .eq('user_id', userId);
          if (partUserErr) console.error('[AccountDeletion] Fallback participant rows for user deletion failed (continuing):', partUserErr);
        } catch (e) {
          console.error('[AccountDeletion] Fallback conversations cascade deletion threw (continuing):', e);
        }
        const { error: profileError } = await supabase
          .from('profiles')
          .delete()
          .eq('id', userId);
        
        if (profileError) {
          console.error('[AccountDeletion] Fallback profile deletion failed:', profileError);
          return {
            success: false,
            message: `${errorMessage}\n\nFallback deletion also failed: ${profileError.message}`,
            info,
          };
        }

        // Clear all local user data before signing out
        await clearLocalUserData();

        // Clear remember me preference
        await clearRememberMePreference();

        // Sign out the user
        // Note: supabase.auth.signOut() calls the storage adapter's removeItem,
        // which clears session data from secure storage automatically
        await supabase.auth.signOut();

        return {
          success: true,
          message: 'Account data deleted successfully.\n\nNote: Complete deletion requires the backend API to be running. An admin may need to complete the deletion from Supabase Dashboard.\n\n' + 
                   (cleanupDetails.length > 0 ? 'The following actions were taken:\n- ' + cleanupDetails.join('\n- ') : ''),
          info,
        };
      } catch (profileError: any) {
        console.error('[AccountDeletion] Fallback failed:', profileError);
        return {
          success: false,
          message: `${errorMessage}\n\nFallback deletion failed: ${profileError.message}. Please contact support for assistance.`,
          info,
        };
      }
    }
  } catch (error: any) {
    console.error('[AccountDeletion] Unexpected error:', error);
    return {
      success: false,
      message: error.message || 'Failed to delete account',
    };
  }
}
