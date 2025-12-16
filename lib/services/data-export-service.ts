/**
 * Data Export Service
 * Implements GDPR Article 20 - Right to data portability
 * Allows users to download all their personal data in JSON format
 */

import * as FileSystem from 'expo-file-system/legacy';
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

// Type for wallet transactions from database
interface WalletTransactionRecord {
  id: string;
  type: string;
  amount: number;
  bounty_id?: string;
  description?: string;
  status?: string;
  created_at?: string;
  [key: string]: unknown; // Allow for additional fields
}

interface UserDataExport {
  exportDate: string;
  profile: Record<string, unknown> | null;
  bounties: {
    created: Record<string, unknown>[];
    accepted: Record<string, unknown>[];
    applications: Record<string, unknown>[];
  };
  conversations: {
    conversations: Record<string, unknown>[];
    participants: Record<string, unknown>[];
  };
  messages: Record<string, unknown>[];
  wallet: {
    transactions: WalletTransactionRecord[];
    currentBalance: number | null;
  };
  notifications: Record<string, unknown>[];
  completions: Record<string, unknown>[];
  skills: Record<string, unknown>[];
  reports: Record<string, unknown>[];
  blockedUsers: Record<string, unknown>[];
  cancellations: Record<string, unknown>[];
  disputes: Record<string, unknown>[];
  completionReady: Record<string, unknown>[];
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
      conversations: {
        conversations: [],
        participants: [],
      },
      messages: [],
      wallet: {
        transactions: [],
        currentBalance: null,
      },
      notifications: [],
      completions: [],
      skills: [],
      reports: [],
      blockedUsers: [],
      cancellations: [],
      disputes: [],
      completionReady: [],
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
        // Store the actual current balance from the profile
        exportData.wallet.currentBalance = profile.balance || 0;
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

    // 5. Get conversations the user participates in
    try {
      const { data: participants, error: partError } = await supabase
        .from('conversation_participants')
        .select('*')
        .eq('user_id', userId);
      
      if (!partError && participants) {
        exportData.conversations.participants = participants;
        
        // Get full conversation details for conversations the user participates in
        if (participants.length > 0) {
          const conversationIds = participants.map((p: any) => p.conversation_id);
          const { data: conversations, error: convError } = await supabase
            .from('conversations')
            .select('*')
            .in('id', conversationIds);
          
          if (!convError && conversations) {
            exportData.conversations.conversations = conversations;
          }
        }
      }
    } catch (e) {
      console.warn('[DataExport] Conversations fetch failed:', e);
    }

    // 6. Get messages sent by the user
    try {
      const { data: messages, error } = await supabase
        .from('messages')
        .select('*')
        .eq('user_id', userId);
      
      if (!error && messages) {
        exportData.messages = messages;
      }
    } catch (e) {
      console.warn('[DataExport] Messages fetch failed:', e);
    }

    // 7. Get wallet transactions
    try {
      const { data: transactions, error } = await supabase
        .from('wallet_transactions')
        .select('*')
        .eq('user_id', userId);
      
      if (!error && transactions) {
        exportData.wallet.transactions = transactions as WalletTransactionRecord[];
        // Note: The actual current balance is retrieved from the profile table above
      }
    } catch (e) {
      console.warn('[DataExport] Wallet transactions fetch failed:', e);
    }

    // 8. Get notifications
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

    // 9. Get completion submissions
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

    // 10. Get skills
    try {
      const { data: skills, error } = await supabase
        .from('skills')
        .select('*')
        .eq('user_id', userId);
      
      if (!error && skills) {
        exportData.skills = skills;
      }
    } catch (e) {
      console.warn('[DataExport] Skills fetch failed:', e);
    }

    // 11. Get reports filed by the user
    try {
      const { data: reports, error } = await supabase
        .from('reports')
        .select('*')
        .eq('user_id', userId);
      
      if (!error && reports) {
        exportData.reports = reports;
      }
    } catch (e) {
      console.warn('[DataExport] Reports fetch failed:', e);
    }

    // 12. Get blocked users (where user is the blocker)
    try {
      const { data: blockedUsers, error } = await supabase
        .from('blocked_users')
        .select('*')
        .eq('blocker_id', userId);
      
      if (!error && blockedUsers) {
        exportData.blockedUsers = blockedUsers;
      }
    } catch (e) {
      console.warn('[DataExport] Blocked users fetch failed:', e);
    }

    // 13. Get bounty cancellations requested by the user
    try {
      const { data: cancellations, error } = await supabase
        .from('bounty_cancellations')
        .select('*')
        .eq('requester_id', userId);
      
      if (!error && cancellations) {
        exportData.cancellations = cancellations;
      }
    } catch (e) {
      console.warn('[DataExport] Cancellations fetch failed:', e);
    }

    // 14. Get bounty disputes initiated by the user
    try {
      const { data: disputes, error } = await supabase
        .from('bounty_disputes')
        .select('*')
        .eq('initiator_id', userId);
      
      if (!error && disputes) {
        exportData.disputes = disputes;
      }
    } catch (e) {
      console.warn('[DataExport] Disputes fetch failed:', e);
    }

    // 15. Get completion ready records for the user as hunter
    try {
      const { data: completionReady, error } = await supabase
        .from('completion_ready')
        .select('*')
        .eq('hunter_id', userId);
      
      if (!error && completionReady) {
        exportData.completionReady = completionReady;
      }
    } catch (e) {
      console.warn('[DataExport] Completion ready fetch failed:', e);
    }

    // Create JSON file
    const jsonString = JSON.stringify(exportData, null, 2);
    // Use generic filename without userId to protect privacy when sharing
    const fileName = `bounty_data_export_${Date.now()}.json`;
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
  } catch (error: unknown) {
    console.error('[DataExport] Unexpected error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to export data. Please try again.';
    return {
      success: false,
      message: errorMessage,
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
  } catch (error: unknown) {
    console.error('[DataExport] Share error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to share data. Please try again.';
    return {
      success: false,
      message: errorMessage,
    };
  }
}
