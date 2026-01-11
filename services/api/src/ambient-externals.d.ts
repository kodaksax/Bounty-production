declare module '@opentelemetry/sdk-node';
declare module '@opentelemetry/auto-instrumentations-node';
declare module '@opentelemetry/exporter-trace-otlp-http';

declare namespace Stripe {
  type PaymentIntent = any;
  type SetupIntent = any;
  type Metadata = any;
  type Address = any;
  type PaymentMethod = any;
  namespace PaymentMethod { export namespace Card { export type Wallet = any } export type Type = any }
  type Refund = any;
  type Account = any;
  namespace Account { export type BusinessProfile = any; export type BusinessType = any; export type Capabilities = any; export type Requirements = any; export type Settings = any; export type Type = any }
  type BankAccount = any;
  type Card = any;
  type Source = any;
  type Event = any;
  type Charge = any;
  type Transfer = any;
  type TransferReversal = any;
  type Payout = any;
  type Dispute = any;
  type TransferCreateParams = any;
  type RequestOptions = any;
  type PaymentIntentCreateParams = any;
  type PaymentIntentConfirmParams = any;
  type SetupIntentCreateParams = any;
  namespace PaymentIntentCancelParams { export type CancellationReason = any }
  type PaymentIntentCancelParams = any;
  type Radar = any;
  namespace Radar { export type EarlyFraudWarning = any }
  type Review = any;
  namespace Review { export type ClosedReason = any; export type IpAddressLocation = any; export type OpenedReason = any; export type Session = any }
}


type Stripe = any;

declare module 'stripe' {
  const StripeModule: any;
  export default StripeModule;
}
