/**
 * Stripe escrow flows.
 *
 * Implements manual-capture PaymentIntent escrow semantics against the
 * backend `/payments/escrows/*` routes:
 *  - `createEscrow`  — create PaymentIntent + record escrow row
 *  - `releaseEscrow` — capture PaymentIntent + transfer to hunter
 *  - `refundEscrow`  — cancel/refund PaymentIntent back to poster
 *
 * Extracted from the original monolithic `stripe-service.ts`.
 */
import { API_BASE_URL } from '../config/api';
import { logger } from '../utils/error-logger';
import { performanceService } from './performance-service';
import {
  handleStripeError,
  StripeEscrowCreateResponse,
  StripeEscrowRefundResponse,
  StripeEscrowReleaseResponse,
  StripePaymentIntent,
} from './stripe-internal';
import { stripeSdk } from './stripe-sdk';

class EscrowService {
  /**
   * Create an escrow PaymentIntent on the backend with manual capture and
   * record the escrow. Returns the escrowId plus PaymentIntent identifiers
   * and client secret for confirmation.
   */
  async createEscrow(
    params: {
      bountyId: string;
      amount: number; // dollars
      posterId: string;
      hunterId: string;
      currency?: string;
    },
    authToken?: string
  ): Promise<StripeEscrowCreateResponse> {
    const { bountyId, amount, posterId, hunterId, currency = 'usd' } = params;

    performanceService.startMeasurement('escrow_create', 'payment_process', {
      bountyId,
      amount,
    });

    try {
      await stripeSdk.initialize();

      if (!bountyId || !posterId || !hunterId || !amount || amount <= 0) {
        throw {
          type: 'validation_error',
          code: 'invalid_params',
          message: 'Invalid escrow parameters',
        };
      }

      const response = await fetch(`${API_BASE_URL}/payments/escrows`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({
          bountyId,
          amountCents: Math.round(amount * 100),
          posterId,
          hunterId,
          currency,
        }),
      });

      if (!response.ok) {
        await performanceService.endMeasurement('escrow_create', {
          success: false,
          status: response.status,
        });
        throw {
          type: 'api_error',
          code: response.status.toString(),
          message: 'Failed to create escrow',
        };
      }

      const data = (await response.json()) as Partial<StripeEscrowCreateResponse> & {
        escrow?: { id?: string };
        clientSecret?: string;
      };

      const escrowId = data.escrowId || data.escrow?.id;

      // Prefer explicit string values; avoid casting undefined to string.
      const paymentIntentClientSecret: string | undefined =
        typeof data.paymentIntentClientSecret === 'string' &&
        data.paymentIntentClientSecret.trim() !== ''
          ? data.paymentIntentClientSecret
          : typeof data.clientSecret === 'string' && data.clientSecret.trim() !== ''
            ? data.clientSecret
            : undefined;

      const paymentIntentId =
        data.paymentIntentId ||
        (paymentIntentClientSecret ? paymentIntentClientSecret.split('_secret_')[0] : undefined);
      const status = (data.status as StripePaymentIntent['status']) || 'requires_payment_method';

      if (!escrowId || !paymentIntentClientSecret || !paymentIntentId) {
        throw {
          type: 'api_error',
          code: 'invalid_response',
          message: 'Missing escrowId or client secret',
        };
      }

      await performanceService.endMeasurement('escrow_create', {
        success: true,
        escrowId,
        paymentIntentId,
      });

      return { escrowId, paymentIntentClientSecret, paymentIntentId, status };
    } catch (error) {
      logger.error('[StripeService] Error creating escrow:', { error });
      await performanceService.endMeasurement('escrow_create', {
        success: false,
        error: String(error),
      });
      throw handleStripeError(error);
    }
  }

  /**
   * Release an escrow by capturing the PaymentIntent and transferring to hunter.
   */
  async releaseEscrow(
    escrowId: string,
    authToken?: string
  ): Promise<StripeEscrowReleaseResponse> {
    performanceService.startMeasurement('escrow_release', 'payment_process', { escrowId });

    try {
      await stripeSdk.initialize();

      if (!escrowId) {
        throw { type: 'validation_error', code: 'invalid_params', message: 'escrowId is required' };
      }

      const response = await fetch(
        `${API_BASE_URL}/payments/escrows/${encodeURIComponent(escrowId)}/release`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
          },
        }
      );

      if (!response.ok) {
        await performanceService.endMeasurement('escrow_release', {
          success: false,
          status: response.status,
        });
        throw {
          type: 'api_error',
          code: response.status.toString(),
          message: 'Failed to release escrow',
        };
      }

      const data = (await response.json()) as StripeEscrowReleaseResponse & {
        transfer?: { id?: string };
        paymentIntent?: { id?: string };
      };

      const transferId = data.transferId || data.transfer?.id;
      const paymentIntentId = data.paymentIntentId || data.paymentIntent?.id;

      await performanceService.endMeasurement('escrow_release', {
        success: true,
        transferId,
        paymentIntentId,
      });

      return { transferId, paymentIntentId, status: data.status };
    } catch (error) {
      logger.error('[StripeService] Error releasing escrow:', { error });
      await performanceService.endMeasurement('escrow_release', {
        success: false,
        error: String(error),
      });
      throw handleStripeError(error);
    }
  }

  /**
   * Refund an escrow: server cancels/refunds the PaymentIntent, returning funds to poster.
   */
  async refundEscrow(escrowId: string, authToken?: string): Promise<StripeEscrowRefundResponse> {
    performanceService.startMeasurement('escrow_refund', 'payment_process', { escrowId });

    try {
      await stripeSdk.initialize();

      if (!escrowId) {
        throw { type: 'validation_error', code: 'invalid_params', message: 'escrowId is required' };
      }

      const response = await fetch(
        `${API_BASE_URL}/payments/escrows/${encodeURIComponent(escrowId)}/refund`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
          },
        }
      );

      if (!response.ok) {
        await performanceService.endMeasurement('escrow_refund', {
          success: false,
          status: response.status,
        });
        throw {
          type: 'api_error',
          code: response.status.toString(),
          message: 'Failed to refund escrow',
        };
      }

      const data = (await response.json()) as StripeEscrowRefundResponse & {
        paymentIntent?: { id?: string };
      };

      const paymentIntentId = data.paymentIntentId || data.paymentIntent?.id;

      await performanceService.endMeasurement('escrow_refund', { success: true, paymentIntentId });

      return { paymentIntentId, refundAmount: data.refundAmount, status: data.status };
    } catch (error) {
      logger.error('[StripeService] Error refunding escrow:', { error });
      await performanceService.endMeasurement('escrow_refund', {
        success: false,
        error: String(error),
      });
      throw handleStripeError(error);
    }
  }
}

/** Exported singleton — use instead of constructing `new EscrowService()`. */
export const escrowService = new EscrowService();
