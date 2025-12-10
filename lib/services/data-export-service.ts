/**
 * Data Export Service
 * Implements GDPR Article 20 - Right to data portability
 * Allows users to download all their personal data in JSON format
 */

import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { supabase } from '../supabase';

// Transaction types for wallet balance calculation
// Based on database schema: wallet_tx_type_enum AS ENUM ('escrow', 'release', 'refund', 'deposit', 'withdrawal')
const WALLET_TRANSACTION_TYPES = {
  ESCROW: 'escrow',       // Money held in escrow (negative - funds locked)
  RELEASE: 'release',     // Money released to hunter (positive for hunter, negative for poster)
  REFUND: 'refund',       // Money refunded to poster (positive for poster)
  DEPOSIT: 'deposit',     // Money deposited to wallet (positive)
  WITHDRAWAL: 'withdrawal', // Money withdrawn from wallet (negative)
} as const;

interface UserDataExport {
  exportDate: string;
  profile: any;
  bounties: {
    created: any[];
    accepted: any[];
    applications: any[];
  };
  messages: any[];
  wallet: {
    transactions: any[];
    balance: number;
  };
  notifications: any[];
  completions: any[];
}

/**
 * Export all user data to a JSON file
 * Returns the data and optionally saves it to a file for sharing
 */
export async function exportUserData(userId: string): Promise<{
  success: boolean;
  message: string;
  data?: UserDataExport;
  filePath?: string;
}> {
  try {
    // Verify user is authenticated
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    
    if (sessionError || !session || session.user.id !== userId) {
      return {
        success: false,
        message: 'Authentication required. Please sign in to export your data.',
      };
    }

    // Collect all user data
    const exportData: UserDataExport = {
      exportDate: new Date().toISOString(),
      profile: null,
      bounties: {
        created: [],
        accepted: [],
        applications: [],
      },
      messages: [],
      wallet: {
        transactions: [],
        balance: 0,
      },
      notifications: [],
      completions: [],
    };

    // 1. Get profile data
    try {
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();
      
      if (!error && profile) {
        // Supabase auth handles passwords separately, so no sensitive fields to remove from profiles
        exportData.profile = profile;
      }
    } catch (e) {
      console.warn('[DataExport] Profile fetch failed:', e);
    }

    // 2. Get bounties created by user
    try {
      const { data: bounties, error } = await supabase
        .from('bounties')
        .select('*')
        .eq('poster_id', userId);
      
      if (!error && bounties) {
        exportData.bounties.created = bounties;
      }
    } catch (e) {
      console.warn('[DataExport] Created bounties fetch failed:', e);
    }

    // 3. Get bounties accepted by user
    try {
      const { data: bounties, error } = await supabase
        .from('bounties')
        .select('*')
        .eq('accepted_by', userId);
      
      if (!error && bounties) {
        exportData.bounties.accepted = bounties;
      }
    } catch (e) {
      console.warn('[DataExport] Accepted bounties fetch failed:', e);
    }

    // 4. Get bounty applications
    try {
      const { data: applications, error } = await supabase
        .from('bounty_requests')
        .select('*')
        .eq('user_id', userId);
      
      if (!error && applications) {
        exportData.bounties.applications = applications;
      }
    } catch (e) {
      console.warn('[DataExport] Applications fetch failed:', e);
    }

    // 5. Get messages
    try {
      const { data: messages, error } = await supabase
        .from('messages')
        .select('*')
        .eq('sender_id', userId);
      
      if (!error && messages) {
        exportData.messages = messages;
      }
    } catch (e) {
      console.warn('[DataExport] Messages fetch failed:', e);
    }

    // 6. Get wallet transactions
    try {
      const { data: transactions, error } = await supabase
        .from('wallet_transactions')
        .select('*')
        .eq('user_id', userId);
      
      if (!error && transactions) {
        exportData.wallet.transactions = transactions;
        // Calculate balance from transactions using defined transaction types
        // Note: The actual balance is maintained by the database/API, this is just an informational calculation
        // Transaction amounts are always stored as positive values; the type determines the direction
        exportData.wallet.balance = transactions.reduce((sum: number, tx: any) => {
          const amount = tx.amount || 0;
          
          switch (tx.type) {
            case WALLET_TRANSACTION_TYPES.DEPOSIT:   // Positive: money added to wallet
            case WALLET_TRANSACTION_TYPES.REFUND:    // Positive: money returned from escrow
              return sum + amount;
              
            case WALLET_TRANSACTION_TYPES.ESCROW:      // Negative: money locked in escrow
            case WALLET_TRANSACTION_TYPES.WITHDRAWAL:  // Negative: money taken out
              return sum - amount;
              
            case WALLET_TRANSACTION_TYPES.RELEASE:   // Context-dependent: depends on role
              // Release increases balance for hunters, decreases for posters
              // Since we're exporting the user's data, we need context to know their role
              // For now, include the transaction but note this needs role context for accurate balance
              return sum; // Skip in calculation as it requires role context
              
            default:
              // Unknown transaction type, skip it
              console.warn(`[DataExport] Unknown transaction type: ${tx.type}`);
              return sum;
          }
        }, 0);
      }
    } catch (e) {
      console.warn('[DataExport] Wallet transactions fetch failed:', e);
    }

    // 7. Get notifications
    try {
      const { data: notifications, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', userId);
      
      if (!error && notifications) {
        exportData.notifications = notifications;
      }
    } catch (e) {
      console.warn('[DataExport] Notifications fetch failed:', e);
    }

    // 8. Get completion submissions
    try {
      const { data: completions, error } = await supabase
        .from('completion_submissions')
        .select('*')
        .eq('hunter_id', userId);
      
      if (!error && completions) {
        exportData.completions = completions;
      }
    } catch (e) {
      console.warn('[DataExport] Completions fetch failed:', e);
    }

    // Create JSON file
    const jsonString = JSON.stringify(exportData, null, 2);
    const fileName = `bounty_data_export_${userId}_${Date.now()}.json`;
    const fileUri = `${FileSystem.documentDirectory}${fileName}`;

    try {
      await FileSystem.writeAsStringAsync(fileUri, jsonString, {
        encoding: FileSystem.EncodingType.UTF8,
      });

      return {
        success: true,
        message: 'Your data has been exported successfully.',
        data: exportData,
        filePath: fileUri,
      };
    } catch (fileError: any) {
      console.error('[DataExport] File write failed:', fileError);
      // Still return the data even if file write fails
      return {
        success: true,
        message: 'Data collected but could not save to file. Data is available in memory.',
        data: exportData,
      };
    }
  } catch (error: any) {
    console.error('[DataExport] Unexpected error:', error);
    return {
      success: false,
      message: error.message || 'Failed to export data. Please try again.',
    };
  }
}

/**
 * Export user data and share it via native sharing
 */
export async function exportAndShareUserData(userId: string): Promise<{
  success: boolean;
  message: string;
}> {
  try {
    const result = await exportUserData(userId);
    
    if (!result.success || !result.filePath) {
      return {
        success: false,
        message: result.message,
      };
    }

    // Check if sharing is available
    const isAvailable = await Sharing.isAvailableAsync();
    
    if (!isAvailable) {
      return {
        success: true,
        message: `Data exported to: ${result.filePath}. Sharing is not available on this device.`,
      };
    }

    // Share the file
    await Sharing.shareAsync(result.filePath, {
      mimeType: 'application/json',
      dialogTitle: 'Export Your Bounty Data',
      UTI: 'public.json',
    });

    return {
      success: true,
      message: 'Data exported and shared successfully.',
    };
  } catch (error: any) {
    console.error('[DataExport] Share error:', error);
    return {
      success: false,
      message: error.message || 'Failed to share data. Please try again.',
    };
  }
}
