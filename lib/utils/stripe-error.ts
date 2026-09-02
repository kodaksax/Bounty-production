export interface SerializedStripeError {
  type?: string;
  code?: string;
  decline_code?: string;
  message: string;
  request_id?: string;
  object_id?: string;
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

  return {
    ...(typeof raw.type === 'string' && { type: raw.type }),
    ...(typeof raw.code === 'string' && { code: raw.code }),
    ...(typeof raw.decline_code === 'string' && { decline_code: raw.decline_code }),
    message,
    ...(requestId && { request_id: requestId }),
    ...(typeof raw.payment_intent === 'string' && { object_id: raw.payment_intent }),
    ...(typeof raw.charge === 'string' && { object_id: raw.charge }),
  };
}
