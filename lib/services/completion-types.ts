/**
 * Shapes of a completion submission. Dependency-free so pure rule code can
 * name them without importing completion-service (and, through it, Supabase).
 * completion-service.ts re-exports these.
 */
export interface ProofItem {
  id: string;
  type: 'image' | 'file';
  name: string;
  url?: string;
  uri?: string;
  size?: number;
  mimeType?: string;
}

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
