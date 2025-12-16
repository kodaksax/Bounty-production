/**
 * Comprehensive TypeScript interfaces for Stripe payment responses
 * Following Stripe API v2025-08-27.basil specifications
 * @see https://docs.stripe.com/api
 */

import Stripe from 'stripe';

/**
 * Payment Intent Response
 * Represents the full payment intent object from Stripe
 */
export interface PaymentIntentResponse {
  id: string;
  object: 'payment_intent';
  amount: number;
  amount_capturable?: number;
  amount_received?: number;
  application?: string | null;
  application_fee_amount?: number | null;
  canceled_at?: number | null;
  cancellation_reason?: Stripe.PaymentIntent.CancellationReason | null;
  capture_method: Stripe.PaymentIntent.CaptureMethod;
  client_secret: string | null;
  confirmation_method: Stripe.PaymentIntent.ConfirmationMethod;
  created: number;
  currency: string;
  customer?: string | null;
  description?: string | null;
  last_payment_error?: Stripe.PaymentIntent.LastPaymentError | null;
  livemode: boolean;
  metadata: Stripe.Metadata;
  next_action?: Stripe.PaymentIntent.NextAction | null;
  payment_method?: string | null;
  payment_method_types: string[];
  processing?: Stripe.PaymentIntent.Processing | null;
  receipt_email?: string | null;
  setup_future_usage?: Stripe.PaymentIntent.SetupFutureUsage | null;
  shipping?: Stripe.PaymentIntent.Shipping | null;
  status: Stripe.PaymentIntent.Status;
  transfer_data?: Stripe.PaymentIntent.TransferData | null;
  transfer_group?: string | null;
}

/**
 * Setup Intent Response
 * For saving payment methods without charging
 */
export interface SetupIntentResponse {
  id: string;
  object: 'setup_intent';
  application?: string | null;
  cancellation_reason?: Stripe.SetupIntent.CancellationReason | null;
  client_secret: string | null;
  created: number;
  customer?: string | null;
  description?: string | null;
  last_setup_error?: Stripe.SetupIntent.LastSetupError | null;
  livemode: boolean;
  mandate?: string | null;
  metadata: Stripe.Metadata;
  next_action?: Stripe.SetupIntent.NextAction | null;
  payment_method?: string | null;
  payment_method_types: string[];
  status: Stripe.SetupIntent.Status;
  usage: string;
}

/**
 * Payment Method Response
 * Represents a saved payment method (card, bank account, etc.)
 */
export interface PaymentMethodResponse {
  id: string;
  object: 'payment_method';
  billing_details: {
    address?: Stripe.Address | null;
    email?: string | null;
    name?: string | null;
    phone?: string | null;
  };
  card?: {
    brand: string;
    checks?: {
      address_line1_check?: string | null;
      address_postal_code_check?: string | null;
      cvc_check?: string | null;
    };
    country?: string;
    exp_month: number;
    exp_year: number;
    fingerprint?: string;
    funding: string;
    last4: string;
    networks?: {
      available: string[];
      preferred?: string | null;
    };
    three_d_secure_usage?: {
      supported: boolean;
    };
    wallet?: Stripe.PaymentMethod.Card.Wallet | null;
  };
  created: number;
  customer?: string | null;
  livemode: boolean;
  metadata: Stripe.Metadata;
  type: Stripe.PaymentMethod.Type;
}

/**
 * Refund Response
 * For cancelled or disputed payments
 */
export interface RefundResponse {
  id: string;
  object: 'refund';
  amount: number;
  balance_transaction?: string | null;
  charge?: string | null;
  created: number;
  currency: string;
  metadata: Stripe.Metadata;
  payment_intent?: string | null;
  reason?: Stripe.Refund.Reason | null;
  receipt_number?: string | null;
  source_transfer_reversal?: string | null;
  status: string | null;
  transfer_reversal?: string | null;
}

/**
 * Stripe Connect Account Response
 * For hunters/payees receiving payments
 */
export interface ConnectAccountResponse {
  id: string;
  object: 'account';
  business_profile?: Stripe.Account.BusinessProfile;
  business_type?: Stripe.Account.BusinessType | null;
  capabilities?: Stripe.Account.Capabilities;
  charges_enabled: boolean;
  country: string;
  created?: number;
  default_currency?: string;
  details_submitted: boolean;
  email?: string | null;
  external_accounts?: {
    object: 'list';
    data: Stripe.BankAccount[] | Stripe.Card[];
    has_more: boolean;
    url: string;
  };
  metadata?: Stripe.Metadata;
  payouts_enabled: boolean;
  requirements?: Stripe.Account.Requirements;
  settings?: Stripe.Account.Settings | null;
  type?: Stripe.Account.Type;
}

/**
 * Account Link Response
 * For onboarding Connect accounts
 */
export interface AccountLinkResponse {
  object: 'account_link';
  created: number;
  expires_at: number;
  url: string;
}

/**
 * Transfer Response
 * For moving funds to Connect accounts
 */
export interface TransferResponse {
  id: string;
  object: 'transfer';
  amount: number;
  amount_reversed: number;
  balance_transaction?: string | null;
  created: number;
  currency: string;
  description?: string | null;
  destination: string;
  destination_payment?: string | null;
  livemode: boolean;
  metadata: Stripe.Metadata;
  reversals: {
    object: 'list';
    data: Stripe.TransferReversal[];
    has_more: boolean;
    url: string;
  };
  reversed: boolean;
  source_transaction?: string | null;
  source_type: string;
  transfer_group?: string | null;
}

/**
 * Webhook Event Response
 * For processing Stripe webhook notifications
 */
export interface WebhookEventResponse<T = unknown> {
  id: string;
  object: 'event';
  api_version: string | null;
  created: number;
  data: {
    object: T;
    previous_attributes?: Partial<T>;
  };
  livemode: boolean;
  pending_webhooks: number;
  request: {
    id: string | null;
    idempotency_key: string | null;
  } | null;
  type: string;
}

/**
 * Payment Error Response
 * Standardized error structure for all payment operations
 */
export interface PaymentErrorResponse {
  error: {
    type: 'card_error' | 'validation_error' | 'api_error' | 'authentication_error' | 'rate_limit_error' | 'idempotency_error';
    code?: string;
    decline_code?: string;
    message: string;
    param?: string;
    charge?: string;
    payment_intent?: PaymentIntentResponse;
    payment_method?: PaymentMethodResponse;
    setup_intent?: SetupIntentResponse;
    source?: Stripe.Source | Stripe.Card | Stripe.BankAccount | unknown;
  };
}

/**
 * Risk Assessment Response
 * For Stripe Radar integration
 */
export interface RiskAssessmentResponse {
  id: string;
  object: 'review';
  billing_zip?: string | null;
  charge?: string | null;
  closed_reason?: Stripe.Review.ClosedReason | null;
  created: number;
  ip_address?: string | null;
  ip_address_location?: Stripe.Review.IpAddressLocation | null;
  livemode: boolean;
  open: boolean;
  opened_reason: Stripe.Review.OpenedReason;
  payment_intent?: string | null;
  reason: string;
  session?: Stripe.Review.Session | null;
}

/**
 * Balance Transaction Response
 * For tracking fees and net amounts
 */
export interface BalanceTransactionResponse {
  id: string;
  object: 'balance_transaction';
  amount: number;
  available_on: number;
  created: number;
  currency: string;
  description?: string | null;
  exchange_rate?: number | null;
  fee: number;
  fee_details: Array<{
    amount: number;
    application?: string | null;
    currency: string;
    description?: string | null;
    type: string;
  }>;
  net: number;
  reporting_category: string;
  source?: string | null;
  status: string;
  type: Stripe.BalanceTransaction.Type;
}

/**
 * Negative Balance Liability
 * Tracks who is responsible for negative balances
 */
export interface NegativeBalanceLiability {
  entity: 'platform' | 'connected_account';
  accountId: string;
  amount: number;
  currency: string;
  reason: string;
  createdAt: Date;
  resolvedAt?: Date;
  status: 'pending' | 'disputed' | 'resolved' | 'written_off';
}

/**
 * Payment Receipt
 * Comprehensive receipt for completed transactions
 */
export interface PaymentReceipt {
  id: string;
  type: 'payment' | 'refund' | 'transfer';
  amount: number;
  currency: string;
  status: 'succeeded' | 'pending' | 'failed' | 'canceled';
  createdAt: Date;
  completedAt?: Date;
  description: string;
  paymentMethod?: {
    type: string;
    last4?: string;
    brand?: string;
  };
  fees: {
    stripeFee: number;
    platformFee: number;
    total: number;
  };
  netAmount: number;
  metadata?: Record<string, string>;
  receiptUrl?: string;
}

/**
 * Payout Schedule Configuration
 * For Connect account payout settings
 */
export interface PayoutSchedule {
  delay_days: number;
  interval: 'manual' | 'daily' | 'weekly' | 'monthly';
  monthly_anchor?: number;
  weekly_anchor?: string;
}

/**
 * Cross-Border Payout Support
 * Configuration for international payments
 */
export interface CrossBorderPayoutConfig {
  supportedCountries: string[];
  supportedCurrencies: string[];
  conversionRates?: Record<string, number>;
  additionalFees?: Record<string, number>;
  processingTimes?: Record<string, string>;
}
