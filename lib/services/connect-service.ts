/**
 * Stripe Connect / hunter payout account flows.
 *
 * Wraps the backend `/payments/create-connect-account`,
 * `/payments/create-account-link`, and
 * `/payments/connect/accounts/:id/verify` endpoints.
 *
 * Extracted from the original monolithic `stripe-service.ts`.
 *
 * SECURITY: Never use secret keys in the client. The backend uses the
 * Stripe SDK with `STRIPE_SECRET_KEY` server-side.
 */
import { API_BASE_URL } from '../config/api';
import { logger } from '../utils/error-logger';
import { performanceService } from './performance-service';
import {
  handleStripeError,
  StripeConnectAccountLinkResponse,
  StripeConnectAccountResponse,
  StripeConnectVerificationResponse,
} from './stripe-internal';
import { stripeSdk } from './stripe-sdk';

class ConnectService {
  /**
   * Create a Stripe Connect Account (server-side via backend API).
   */
  async createConnectAccount(
    userId: string,
    email: string,
    authToken?: string
  ): Promise<StripeConnectAccountResponse> {
    performanceService.startMeasurement('connect_account_create', 'payment_process', {
      userId,
    });

    try {
      await stripeSdk.initialize();

      if (!userId || !email) {
        throw {
          type: 'validation_error',
          code: 'invalid_params',
          message: 'userId and email are required',
        };
      }

      const response = await fetch(`${API_BASE_URL}/payments/create-connect-account`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({ userId, email }),
      });

      if (!response.ok) {
        await performanceService.endMeasurement('connect_account_create', {
          success: false,
          status: response.status,
        });
        throw {
          type: 'api_error',
          code: response.status.toString(),
          message: 'Failed to create Connect account',
        };
      }

      const data = (await response.json()) as Partial<StripeConnectAccountResponse> & {
        account?: { id?: string };
      };
      const accountId = data.accountId || data?.account?.id;

      if (!accountId) {
        throw {
          type: 'api_error',
          code: 'invalid_response',
          message: 'Missing accountId in response',
        };
      }

      await performanceService.endMeasurement('connect_account_create', {
        success: true,
        accountId,
      });

      return { accountId };
    } catch (error) {
      logger.error('[StripeService] Error creating connect account:', { error });

      await performanceService.endMeasurement('connect_account_create', {
        success: false,
        error: String(error),
      });

      throw handleStripeError(error);
    }
  }

  /**
   * Create a Stripe Connect onboarding Account Link (server-side via backend API).
   */
  async createConnectAccountLink(accountId: string, authToken?: string): Promise<string> {
    performanceService.startMeasurement('connect_account_link', 'payment_process', { accountId });

    try {
      await stripeSdk.initialize();

      if (!accountId) {
        throw {
          type: 'validation_error',
          code: 'invalid_params',
          message: 'accountId is required',
        };
      }

      const response = await fetch(`${API_BASE_URL}/payments/create-account-link`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({ accountId }),
      });

      if (!response.ok) {
        await performanceService.endMeasurement('connect_account_link', {
          success: false,
          status: response.status,
        });
        throw {
          type: 'api_error',
          code: response.status.toString(),
          message: 'Failed to create account link',
        };
      }

      const data = (await response.json()) as StripeConnectAccountLinkResponse & {
        accountLink?: { url?: string };
      };
      const url = data.url || data?.accountLink?.url;

      if (!url) {
        throw { type: 'api_error', code: 'invalid_response', message: 'Missing url in response' };
      }

      await performanceService.endMeasurement('connect_account_link', { success: true });

      return url;
    } catch (error) {
      logger.error('[StripeService] Error creating connect account link:', { error });

      await performanceService.endMeasurement('connect_account_link', {
        success: false,
        error: String(error),
      });

      throw handleStripeError(error);
    }
  }

  /**
   * Verify a Stripe Connect account status via backend
   * (details_submitted/capabilities).
   */
  async verifyConnectAccount(
    accountId: string,
    authToken?: string
  ): Promise<StripeConnectVerificationResponse> {
    try {
      await stripeSdk.initialize();

      if (!accountId) {
        throw {
          type: 'validation_error',
          code: 'invalid_params',
          message: 'accountId is required',
        };
      }

      const response = await fetch(
        `${API_BASE_URL}/payments/connect/accounts/${encodeURIComponent(accountId)}/verify`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
          },
        }
      );

      if (!response.ok) {
        throw {
          type: 'api_error',
          code: response.status.toString(),
          message: 'Failed to verify account',
        };
      }

      const data = (await response.json()) as StripeConnectVerificationResponse & {
        account?: { details_submitted?: boolean; capabilities?: any };
      };
      const detailsSubmitted = data.detailsSubmitted ?? data.account?.details_submitted ?? false;
      const capabilities = data.capabilities ?? data.account?.capabilities ?? {};
      return { detailsSubmitted, capabilities };
    } catch (error) {
      logger.error('[StripeService] Error verifying connect account:', { error });
      throw handleStripeError(error);
    }
  }
}

/** Exported singleton — use instead of constructing `new ConnectService()`. */
export const connectService = new ConnectService();
