import { isSupabaseConfigured, supabase } from 'lib/supabase';
import { logger } from 'lib/utils/error-logger';

export interface CompletionSubmission {
  id?: string;
  bounty_id: string;
  hunter_id: string;
  message: string;
  proof_items: ProofItem[];
  submitted_at?: string;
  status: 'pending' | 'approved' | 'rejected' | 'revision_requested';
  poster_feedback?: string;
  revision_count?: number;
}

export interface ProofItem {
  id: string;
  type: 'image' | 'file';
  name: string;
  url?: string;
  uri?: string;
  size?: number;
  mimeType?: string;
}

export interface Rating {
  id?: string;
  bounty_id: string;
  from_user_id: string;
  to_user_id: string;
  rating: number; // 1-5
  comment?: string;
  created_at?: string;
}

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3001';

export const completionService = {
  /**
   * Submit completion for review
   */
  async submitCompletion(submission: Omit<CompletionSubmission, 'id' | 'submitted_at' | 'status'>): Promise<CompletionSubmission | null> {
    try {
      if (isSupabaseConfigured) {
        const { data, error } = await supabase
          .from('completion_submissions')
          .insert({
            ...submission,
            status: 'pending',
            submitted_at: new Date().toISOString(),
            proof_items: JSON.stringify(submission.proof_items),
          })
          .select('*')
          .single();

  if (error) throw new Error(error?.message ?? JSON.stringify(error));
        
        return {
          ...data,
          proof_items: JSON.parse(data.proof_items || '[]'),
        } as CompletionSubmission;
      }

      const response = await fetch(`${API_BASE_URL}/api/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...submission,
          status: 'pending',
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to submit completion: ${errorText}`);
      }

      return await response.json();
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      logger.error('Error submitting completion', { submission, error });
      throw error;
    }
  },

  /**
   * Get completion submission for a bounty
   */
  async getSubmission(bountyId: string): Promise<CompletionSubmission | null> {
    try {
      if (isSupabaseConfigured) {
        const { data, error } = await supabase
          .from('completion_submissions')
          .select('*')
          .eq('bounty_id', bountyId)
          .order('submitted_at', { ascending: false })
          .limit(1)
          .single();

        if (error) {
          if (error.code === 'PGRST116') return null; // No rows
          throw new Error(error?.message ?? JSON.stringify(error));
        }

        return {
          ...data,
          proof_items: JSON.parse(data.proof_items || '[]'),
        } as CompletionSubmission;
      }

      const response = await fetch(`${API_BASE_URL}/api/completions/${bountyId}`);
      if (!response.ok) {
        if (response.status === 404) return null;
        throw new Error('Failed to fetch completion');
      }

      return await response.json();
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      logger.error('Error fetching completion', { bountyId, error });
      return null;
    }
  },

  /**
   * Approve completion (poster action)
   */
  async approveCompletion(submissionId: string): Promise<boolean> {
    try {
      if (isSupabaseConfigured) {
        const { error } = await supabase
          .from('completion_submissions')
          .update({ status: 'approved' })
          .eq('id', submissionId);

        if (error) throw error;
        return true;
      }

      const response = await fetch(`${API_BASE_URL}/api/completions/${submissionId}/approve`, {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error('Failed to approve completion');
      }

      return true;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      logger.error('Error approving completion', { submissionId, error });
      throw error;
    }
  },

  /**
   * Request revision (poster action)
   */
  async requestRevision(submissionId: string, feedback: string): Promise<boolean> {
    try {
      if (isSupabaseConfigured) {
        const { error } = await supabase
          .from('completion_submissions')
          .update({ 
            status: 'revision_requested',
            poster_feedback: feedback,
          })
          .eq('id', submissionId);

        if (error) throw error;
        return true;
      }

      const response = await fetch(`${API_BASE_URL}/api/completions/${submissionId}/request-revision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback }),
      });

      if (!response.ok) {
        throw new Error('Failed to request revision');
      }

      return true;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      logger.error('Error requesting revision', { submissionId, error });
      throw error;
    }
  },

  /**
   * Submit rating
   */
  async submitRating(rating: Omit<Rating, 'id' | 'created_at'>): Promise<Rating | null> {
    try {
      if (isSupabaseConfigured) {
        const { data, error } = await supabase
          .from('ratings')
          .insert({
            ...rating,
            created_at: new Date().toISOString(),
          })
          .select('*')
          .single();

        if (error) throw error;
        return data as Rating;
      }

      const response = await fetch(`${API_BASE_URL}/api/ratings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rating),
      });

      if (!response.ok) {
        throw new Error('Failed to submit rating');
      }

      return await response.json();
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      logger.error('Error submitting rating', { rating, error });
      throw error;
    }
  },

  /**
   * Get ratings for a user
   */
  async getUserRatings(userId: string): Promise<Rating[]> {
    try {
      if (isSupabaseConfigured) {
        const { data, error } = await supabase
          .from('ratings')
          .select('*')
          .eq('to_user_id', userId)
          .order('created_at', { ascending: false });

        if (error) throw error;
        return (data as Rating[]) || [];
      }

      const response = await fetch(`${API_BASE_URL}/api/ratings/user/${userId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch ratings');
      }

      return await response.json();
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      logger.error('Error fetching user ratings', { userId, error });
      return [];
    }
  },
};
