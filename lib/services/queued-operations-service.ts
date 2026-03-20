import { supabase } from '../supabase';
import { paymentService } from './payment-service';
import { API_BASE_URL } from '../config/api';

export interface OperationQueueData {
  opType: string;
  payload: Record<string, any>;
  idempotencyKey?: string;
}

/**
 * Handles queued operations that were enqueued while offline.
 * Keep logic minimal: perform the server-side API call and surface errors
 * so the offline queue can retry with backoff.
 */
export const queuedOperationsService = {
  async processQueuedOperation(op: OperationQueueData) {
    switch (op.opType) {
      case 'release_escrow': {
        // Payload should include either `escrowId` (payment_intent_id) or { bountyId, hunterId }
        const { escrowId, bountyId, hunterId } = op.payload || {};

        // Try using paymentService path which mirrors client logic and handles auth
        try {
          // Get access token if available
          const { data: sessionData } = await supabase.auth.getSession();
          const token = sessionData.session?.access_token ?? undefined;

          if (escrowId) {
            await paymentService.releaseEscrow(escrowId, token);
            return true;
          }

          // Fallback: call server release endpoint by bounty/hunter
          const body = { bountyId, hunterId, idempotencyKey: op.idempotencyKey };
          const resp = await fetch(`${API_BASE_URL}/wallet/release`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify(body),
          });

          if (!resp.ok) {
            const text = await resp.text().catch(() => '');
            throw new Error(`Release API failed: ${resp.status} ${text}`);
          }

          return true;
        } catch (err) {
          throw err;
        }
      }

      default:
        throw new Error(`Unsupported queued operation: ${op.opType}`);
    }
  },
};
