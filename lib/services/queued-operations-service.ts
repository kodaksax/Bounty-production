import { API_BASE_URL } from '../config/api';
import { supabase } from '../supabase';
import { paymentService } from './payment-service';

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
    // Helper: attempt to get supabase session token but don't wait indefinitely
    const getSessionToken = async (timeoutMs = 2000): Promise<string | undefined> => {
      try {
        const sessionPromise = supabase.auth.getSession();
        const timeout = new Promise(resolve => setTimeout(() => resolve({ data: { session: null } }), timeoutMs));
        // Race to avoid hanging when supabase init blocks in test envs
        const { data: sessionData } = (await Promise.race([sessionPromise, timeout]) as any) || { data: { session: null } };
        return sessionData?.session?.access_token ?? undefined;
      } catch {
        return undefined;
      }
    };

    switch (op.opType) {
      case 'release_escrow': {
        // Payload should include either `escrowId` (payment_intent_id) or { bountyId, hunterId }
        const { escrowId, bountyId, hunterId } = op.payload || {};

        // Try using paymentService path which mirrors client logic and handles auth
        try {
          // Get access token if available
          const token = await getSessionToken();

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

      case 'refund_escrow': {
        // Payload should include either `escrowId` (payment_intent_id) or { bountyId, refundPercentage }
        const { escrowId, bountyId, refundPercentage } = op.payload || {};

        // Validate payload: require either escrowId OR (bountyId and refundPercentage)
        const hasEscrowId = !!escrowId;
        const hasBountyAndRefund =
          !!bountyId && typeof refundPercentage === 'number' && Number.isFinite(refundPercentage);

        if (!hasEscrowId && !hasBountyAndRefund) {
          throw new Error(
            'Invalid refund_escrow payload: must include escrowId or bountyId and refundPercentage'
          );
        }

        try {
          const token = await getSessionToken();

          if (escrowId) {
            const res = await paymentService.refundEscrow(escrowId, token);
            if (!res || !res.success) throw new Error(res?.error?.message || 'Refund failed');
            return true;
          }

          // Fallback: call server refund endpoint by bounty
          const body = { bountyId, refundPercentage, idempotencyKey: op.idempotencyKey };
          const resp = await fetch(`${API_BASE_URL}/wallet/refund`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify(body),
          });

          if (!resp.ok) {
            const text = await resp.text().catch(() => '');
            throw new Error(`Refund API failed: ${resp.status} ${text}`);
          }

          return true;
        } catch (err: any) {
          const baseMessage = err instanceof Error ? err.message : String(err);
          const contextId = escrowId || bountyId || 'unknown';
          throw new Error(`Refund operation failed for ${contextId}: ${baseMessage}`);
        }
      }

      default:
        throw new Error(`Unsupported queued operation: ${op.opType}`);
    }
  },
};
