/**
 * SDK codes that say a call failed without saying why. The Stripe React Native
 * SDK puts one of these in `code` and the real reason in `stripeErrorCode` /
 * `declineCode`. They are never reported as `code`.
 */
const GENERIC_CODES = new Set(['Failed', 'Canceled', 'Timeout', 'Unknown', 'unknown']);

export interface SerializedStripeError {
  type?: string;
  /** A real Stripe (or backend) error code. Never one of GENERIC_CODES. */
  code?: string;
  decline_code?: string;
  /** The Stripe React Native SDK's own enum ('Failed', 'Canceled', ...). */
  sdk_code?: string;
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

  // The SDK's `code` is its own enum; the Stripe code is `stripeErrorCode`.
  // Reading only `code` is what turned an `incorrect_zip` Apple Pay failure
  // into error_code "Failed" in PostHog.
  const rawCode = typeof raw.code === 'string' && raw.code ? raw.code : undefined;
  const stripeErrorCode =
    typeof raw.stripeErrorCode === 'string' && raw.stripeErrorCode
      ? raw.stripeErrorCode
      : undefined;
  const sdkCode =
    typeof raw.sdk_code === 'string'
      ? raw.sdk_code
      : rawCode && GENERIC_CODES.has(rawCode)
        ? rawCode
        : undefined;
  const code = stripeErrorCode ?? (rawCode && !GENERIC_CODES.has(rawCode) ? rawCode : undefined);

  return {
    ...(typeof raw.type === 'string' && { type: raw.type }),
    ...(code && { code }),
    ...(declineCode && !GENERIC_CODES.has(declineCode) && { decline_code: declineCode }),
    ...(sdkCode && { sdk_code: sdkCode }),
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

const MAX_ERROR_MESSAGE_LENGTH = 200;

/**
 * What the payer was paying with. 'payment_sheet' means the Stripe Payment
 * Sheet failed before we could learn which method inside it was used.
 */
export type PaymentMethodTypeTag =
  | 'card'
  | 'apple_pay'
  | 'google_pay'
  | 'us_bank_account'
  | 'payment_sheet';

// A type alias, not an interface, so it satisfies AnalyticsProperties' index signature.
export type FailureEventProps = {
  /**
   * The one field to group failures by: the decline code when there is one,
   * otherwise the Stripe/backend code. When Stripe gave no code at all this
   * is `sdk_<enum>` (e.g. `sdk_failed`) — explicit, never a bare "Failed".
   */
  error_code: string;
  /** Stripe error type (`card_error`, `api_error`, ...). */
  type?: string;
  /** Same as `type`; kept because existing insights group by it. */
  error_type?: string;
  decline_code?: string;
  /** Real Stripe/backend code. Never a generic SDK enum. */
  code?: string;
  /** The Stripe React Native SDK's own enum, when that was all we got. */
  sdk_code?: string;
  payment_method_type?: PaymentMethodTypeTag;
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
export function failureEventProps(
  error: unknown,
  fallbackCode = 'unknown',
  paymentMethodType?: PaymentMethodTypeTag
): FailureEventProps {
  const method = paymentMethodType ? { payment_method_type: paymentMethodType } : {};
  if (error == null) {
    // Nothing was thrown — serializeStripeError would say 'Unknown Stripe error',
    // which misdescribes a failure the caller has already named.
    return {
      error_code: fallbackCode,
      error_message: `No error thrown (${fallbackCode})`,
      ...method,
    };
  }
  const serialized = serializeStripeError(error);
  const sdkFallback = serialized.sdk_code ? `sdk_${serialized.sdk_code.toLowerCase()}` : undefined;

  return {
    error_code: serialized.decline_code ?? serialized.code ?? sdkFallback ?? fallbackCode,
    ...(serialized.type && { type: serialized.type, error_type: serialized.type }),
    ...(serialized.decline_code && { decline_code: serialized.decline_code }),
    ...(serialized.code && { code: serialized.code }),
    ...(serialized.sdk_code && { sdk_code: serialized.sdk_code }),
    ...method,
    error_message: serialized.message.slice(0, MAX_ERROR_MESSAGE_LENGTH),
    ...(serialized.request_id && { request_id: serialized.request_id }),
    ...(serialized.payment_intent_id && { payment_intent_id: serialized.payment_intent_id }),
    ...(serialized.charge_id && { charge_id: serialized.charge_id }),
  };
}

/**
 * Builds failure props from a PaymentIntent's `lastPaymentError` as the
 * Stripe React Native SDK returns it from `retrievePaymentIntent`. Used when
 * the Payment Sheet only reports "Canceled"/"Failed": a decline shown inside
 * the sheet is recorded on the intent, not returned to us.
 */
export function failureFromLastPaymentError(
  lastPaymentError: unknown,
  paymentIntentId: string | undefined,
  fallbackMethod: PaymentMethodTypeTag
): FailureEventProps | null {
  if (!lastPaymentError || typeof lastPaymentError !== 'object') return null;
  const err = lastPaymentError as Record<string, unknown>;
  const pm = (err.paymentMethod && typeof err.paymentMethod === 'object'
    ? err.paymentMethod
    : {}) as Record<string, unknown>;
  const props = failureEventProps(
    {
      type: err.type,
      code: err.code,
      stripeErrorCode: err.stripeErrorCode,
      declineCode: err.declineCode,
      message: err.message,
    },
    'unknown',
    paymentMethodTypeFromSdk(pm) ?? fallbackMethod
  );
  return paymentIntentId ? { ...props, payment_intent_id: paymentIntentId } : props;
}

/**
 * Maps an SDK PaymentMethod result to our tag. Deliberately does not map
 * 'Card' to 'card': the SDK's CardResult carries no wallet field, so an Apple
 * Pay or Google Pay card is indistinguishable from a typed one here and the
 * caller's fallback ('payment_sheet') is the honest answer.
 */
function paymentMethodTypeFromSdk(pm: Record<string, unknown>): PaymentMethodTypeTag | undefined {
  return pm.paymentMethodType === 'USBankAccount' ? 'us_bank_account' : undefined;
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
