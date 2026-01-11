declare module '@opentelemetry/sdk-node';
declare module '@opentelemetry/auto-instrumentations-node';
declare module '@opentelemetry/exporter-trace-otlp-http';

declare namespace Stripe {
  // Narrowed, but still permissive, placeholders for commonly used Stripe types
  interface Metadata {
    [key: string]: string | number | boolean | null | undefined;
  }

  interface Address {
    city?: string | null;
    country?: string | null;
    line1?: string | null;
    line2?: string | null;
    postal_code?: string | null;
    state?: string | null;
    [key: string]: any;
  }

  interface PaymentIntent {
    id: string;
    amount?: number;
    currency?: string;
    status?:
      | 'requires_payment_method'
      | 'requires_confirmation'
      | 'requires_action'
      | 'processing'
      | 'requires_capture'
      | 'canceled'
      | 'succeeded'
      | string;
    metadata?: Metadata;
    [key: string]: any;
  }

  interface SetupIntent {
    id: string;
    status?: string;
    metadata?: Metadata;
    [key: string]: any;
  }

  interface PaymentMethod {
    id: string;
    type?: PaymentMethod.Type;
    billing_details?: {
      name?: string | null;
      email?: string | null;
      phone?: string | null;
      address?: Address | null;
      [key: string]: any;
    };
    card?: Card | null;
    [key: string]: any;
  }

  namespace PaymentMethod {
    export type Type =
      | 'card'
      | 'card_present'
      | 'us_bank_account'
      | 'link'
      | string;

    export namespace Card {
      export interface Wallet {
        type?: string;
        dynamic_last4?: string | null;
        [key: string]: any;
      }
    }
  }

  interface Refund {
    id: string;
    amount?: number;
    currency?: string;
    status?: string;
    metadata?: Metadata;
    [key: string]: any;
  }

  interface Account {
    id: string;
    business_profile?: Account.BusinessProfile | null;
    business_type?: Account.BusinessType | null;
    capabilities?: Account.Capabilities | null;
    requirements?: Account.Requirements | null;
    settings?: Account.Settings | null;
    type?: Account.Type;
    [key: string]: any;
  }

  namespace Account {
    export interface BusinessProfile {
      name?: string | null;
      support_email?: string | null;
      support_phone?: string | null;
      url?: string | null;
      [key: string]: any;
    }

    export type BusinessType =
      | 'company'
      | 'government_entity'
      | 'individual'
      | 'non_profit'
      | string;

    export interface Capabilities {
      [key: string]: 'active' | 'inactive' | 'pending' | string;
    }

    export interface Requirements {
      currently_due?: string[];
      past_due?: string[];
      eventually_due?: string[];
      disabled_reason?: string | null;
      [key: string]: any;
    }

    export interface Settings {
      payouts?: {
        schedule?: {
          interval?: string;
          [key: string]: any;
        };
        [key: string]: any;
      };
      [key: string]: any;
    }

    export type Type = 'standard' | 'express' | 'custom' | string;
  }

  interface BankAccount {
    id: string;
    object?: 'bank_account' | string;
    last4?: string;
    bank_name?: string | null;
    country?: string | null;
    currency?: string | null;
    [key: string]: any;
  }

  interface Card {
    id?: string;
    object?: 'card' | string;
    last4?: string;
    brand?: string;
    exp_month?: number;
    exp_year?: number;
    country?: string | null;
    [key: string]: any;
  }

  interface Source {
    id: string;
    object?: string;
    type?: string;
    [key: string]: any;
  }

  interface Event {
    id: string;
    type: string;
    created?: number;
    data: {
      object: any;
      [key: string]: any;
    };
    [key: string]: any;
  }

  interface Charge {
    id: string;
    amount?: number;
    currency?: string;
    paid?: boolean;
    refunded?: boolean;
    balance_transaction?: string | null;
    metadata?: Metadata;
    [key: string]: any;
  }

  interface Transfer {
    id: string;
    amount?: number;
    currency?: string;
    destination?: string | null;
    reversals?: {
      data?: TransferReversal[];
      [key: string]: any;
    };
    [key: string]: any;
  }

  interface TransferReversal {
    id: string;
    amount?: number;
    [key: string]: any;
  }

  interface Payout {
    id: string;
    amount?: number;
    currency?: string;
    status?: string;
    [key: string]: any;
  }

  interface Dispute {
    id: string;
    amount?: number;
    currency?: string;
    status?: string;
    reason?: string | null;
    [key: string]: any;
  }

  interface TransferCreateParams {
    amount: number;
    currency: string;
    destination: string;
    [key: string]: any;
  }

  interface RequestOptions {
    idempotencyKey?: string;
    apiKey?: string;
    stripeAccount?: string;
    [key: string]: any;
  }

  namespace Review {
    export type ClosedReason = 'approved' | 'refunded' | 'refunded_as_fraud' | 'disputed' | string;

    export interface IpAddressLocation {
      city?: string | null;
      country?: string | null;
      latitude?: number | null;
      longitude?: number | null;
      [key: string]: any;
    }

    export type OpenedReason = 'rule' | 'manual' | string;

    export interface Session {
      browser?: string | null;
      device?: string | null;
      ip_address?: string | null;
      [key: string]: any;
    }
  }

  namespace BalanceTransaction {
    export type Type =
      | 'charge'
      | 'refund'
      | 'adjustment'
      | 'application_fee'
      | 'application_fee_refund'
      | 'transfer'
      | 'transfer_refund'
      | 'payout'
      | 'payout_cancel'
      | 'payout_failure'
      | string;
  }
}

// Allow using `Stripe` as a type (e.g., `let stripe: Stripe | null`)
interface StripeClient {
  /**
   * This is a deliberately minimal Stripe client surface. It keeps an
   * index signature for flexibility while avoiding `any` at the top level.
   */
  [key: string]: any;
}

type Stripe = StripeClient;
declare module 'stripe' {
  const StripeModule: any;
  export default StripeModule;
}
