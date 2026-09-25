export interface SerializedStripeError {
  type?: string;
  code?: string;
  decline_code?: string;
  message: string;
  request_id?: string;
  object_id?: string;
  payment_intent_id?: string;
  charge_id?: string;
}

/**
 * Extracts safe, useful fields from Stripe errors without coercing objects to
 * "[object Object]" or sending payment credentials to analytics.
 */
export function serializeStripeError(error: unknown): SerializedStripeError {
  const value = (error && typeof error === 'object' ? error : {}) as Record<string, unknown>;
  const raw = (value.raw && typeof value.raw === 'object' ? value.raw : value) as Record<
    string,
    unknown
  >;
  const requestId =
    typeof value.requestId === 'string'
      ? value.requestId
      : typeof raw.request_id === 'string'
        ? raw.request_id
        : undefined;
  const message =
    typeof value.message === 'string'
      ? value.message
      : typeof raw.message === 'string'
        ? raw.message
        : typeof error === 'string'
          ? error
          : 'Unknown Stripe error';

  // The Stripe React Native SDK spells it `declineCode`.
  const declineCode =
    typeof raw.decline_code === 'string'
      ? raw.decline_code
      : typeof raw.declineCode === 'string'
        ? raw.declineCode
        : undefined;

  return {
    ...(typeof raw.type === 'string' && { type: raw.type }),
    ...(typeof raw.code === 'string' && { code: raw.code }),
    ...(declineCode && { decline_code: declineCode }),
    message,
    ...(requestId && { request_id: requestId }),
    ...(typeof raw.payment_intent === 'string' && {
      object_id: raw.payment_intent,
      payment_intent_id: raw.payment_intent,
    }),
    ...(typeof raw.charge === 'string' && {
      ...(!(typeof raw.payment_intent === 'string') && { object_id: raw.charge }),
      charge_id: raw.charge,
    }),
  };
}

/**
 * SDK codes that say a call failed without saying why. The Stripe React Native
 * SDK puts one of these in `code` and the actual reason in `declineCode`.
 */
const GENERIC_CODES = new Set(['Failed', 'Canceled', 'Timeout', 'Unknown', 'unknown']);

const MAX_ERROR_MESSAGE_LENGTH = 200;

// A type alias, not an interface, so it satisfies AnalyticsProperties' index signature.
export type FailureEventProps = {
  /**
   * The one field to group failures by: the decline code when there is one,
   * otherwise the most specific error code (Stripe, backend or HTTP status).
   */
  error_code: string;
  error_type?: string;
  decline_code?: string;
  /** The raw `code`, kept when it is less specific than `error_code`. */
  code?: string;
  error_message: string;
  request_id?: string;
  payment_intent_id?: string;
  charge_id?: string;
};

/**
 * The shared property set for every `*_failed` analytics event. Accepts
 * anything a catch block can receive — Error instances, the plain objects
 * `invokePayments` and the Stripe SDK throw, strings, or nothing — and never
 * produces "[object Object]". Pass `fallbackCode` for failures that arrive as
 * a result value rather than a thrown error (e.g. a refund that returns false).
 */
export function failureEventProps(error: unknown, fallbackCode = 'unknown'): FailureEventProps {
  if (error == null) {
    // Nothing was thrown — serializeStripeError would say 'Unknown Stripe error',
    // which misdescribes a failure the caller has already named.
    return { error_code: fallbackCode, error_message: `No error thrown (${fallbackCode})` };
  }
  const serialized = serializeStripeError(error);
  const specificCode =
    serialized.code && !GENERIC_CODES.has(serialized.code) ? serialized.code : undefined;

  return {
    error_code: serialized.decline_code ?? specificCode ?? serialized.code ?? fallbackCode,
    ...(serialized.type && { error_type: serialized.type }),
    ...(serialized.decline_code && { decline_code: serialized.decline_code }),
    ...(serialized.code && { code: serialized.code }),
    error_message: serialized.message.slice(0, MAX_ERROR_MESSAGE_LENGTH),
    ...(serialized.request_id && { request_id: serialized.request_id }),
    ...(serialized.payment_intent_id && { payment_intent_id: serialized.payment_intent_id }),
    ...(serialized.charge_id && { charge_id: serialized.charge_id }),
  };
}

/**
 * The PaymentIntent id embedded in a client secret (`pi_..._secret_...`), or
 * undefined when the value doesn't have that shape. Never returns the secret
 * itself, so it is safe to put the result in analytics or logs.
 */
export function getPaymentIntentIdFromClientSecret(clientSecret: unknown): string | undefined {
  if (typeof clientSecret !== 'string') return undefined;
  return /^(pi_[A-Za-z0-9]+)_secret_/.exec(clientSecret)?.[1];
}
