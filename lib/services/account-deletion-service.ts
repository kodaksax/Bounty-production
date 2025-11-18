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

import { supabase } from '../supabase';
import { getApiBaseUrl } from '../config/api';

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
    console.warn('[AccountDeletion] Failed to count created bounties:', e);
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
    console.warn('[AccountDeletion] Failed to count accepted bounties:', e);
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
    console.warn('[AccountDeletion] Failed to calculate escrow:', e);
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
    console.warn('[AccountDeletion] Failed to count applications:', e);
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
    // Get the current user
    const { data: { user, session } } = await supabase.auth.getUser();
    
    if (!user || !session) {
      return {
        success: false,
        message: 'No authenticated user found',
      };
    }

    const userId = user.id;

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
    const apiBaseUrl = getApiBaseUrl(3000); // Default to port 3000 for the api server
    
    try {
      const response = await fetch(`${apiBaseUrl}/auth/delete-account`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        console.error('[AccountDeletion] API deletion failed:', result);
        return {
          success: false,
          message: result.message || 'Failed to delete account',
          info,
        };
      }

      // Sign out the user after successful deletion
      await supabase.auth.signOut();

      return {
        success: true,
        message: 'Account deleted successfully.\n\n' + 
                 (cleanupDetails.length > 0 ? 'The following actions were taken:\n- ' + cleanupDetails.join('\n- ') : ''),
        info,
      };
    } catch (fetchError: any) {
      console.error('[AccountDeletion] Network error:', fetchError);
      
      // Fallback: Try to delete profile directly if API is not available
      console.warn('[AccountDeletion] API not available, attempting fallback...');
      
      try {
        const { error: profileError } = await supabase
          .from('profiles')
          .delete()
          .eq('id', userId);
        
        if (profileError) {
          return {
            success: false,
            message: `Failed to delete profile: ${profileError.message}`,
            info,
          };
        }

        // Sign out the user
        await supabase.auth.signOut();

        return {
          success: true,
          message: 'Account data deleted successfully. Note: Complete deletion requires the backend API to be running. An admin may need to complete the deletion from Supabase Dashboard.\n\n' + 
                   (cleanupDetails.length > 0 ? 'The following actions were taken:\n- ' + cleanupDetails.join('\n- ') : ''),
          info,
        };
      } catch (profileError: any) {
        return {
          success: false,
          message: `Failed to delete account: ${profileError.message}. Please ensure the backend API is running.`,
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
