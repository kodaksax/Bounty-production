// Lazy-load logger to avoid importing pino (and its diagnostics hooks)
// during module initialization in unit tests.
let _logger: any | null = null;
async function getLogger(): Promise<any> {
  if (_logger) return _logger;
  if (process.env.NODE_ENV === 'test') {
    _logger = console;
    return _logger;
  }
  const mod = await import('./logger');
  _logger = mod.logger ?? mod.default ?? console;
  return _logger;
}

// Note: do not import idempotency-service or analytics at module level — those
// modules import the logger (pino) and can trigger diagnostics_channel
// initialization that breaks the test environment. Dynamically import them
// inside the function where needed.

/**
 * Safely execute a Stripe call with idempotency protection using the IdempotencyService.
 * - Checks if the idempotency key already exists and throws if duplicate detected.
 * - Stores the key before calling Stripe to prevent concurrent duplicates across instances.
 * - Removes the key if the Stripe call fails to allow retries.
 */
export async function withStripeIdempotency<T>(
  idempotencyKey: string,
  fn: (opts?: any) => Promise<T>,
  ttlSeconds: number = 60 * 60 * 24
): Promise<T> {
  if (!idempotencyKey || typeof idempotencyKey !== 'string') {
    // No idempotency key provided — just call through
    return fn();
  }

  try {
    const idempoMod = await import('./idempotency-service');
    const { checkIdempotencyKey, storeIdempotencyKey, removeIdempotencyKey } = idempoMod;
    const exists = await checkIdempotencyKey(idempotencyKey);
    if (exists) {
      (await getLogger()).warn({ idempotencyKey }, '[stripe-safeguards] Duplicate idempotency key detected');
      throw new Error('Duplicate idempotency key');
    }

    // Reserve the key
    await storeIdempotencyKey(idempotencyKey, ttlSeconds);

    // Call the provided function with an options arg containing the idempotency key
    const result = await fn({ idempotencyKey });
    // Track successful Stripe call
    try {
      const analyticsMod = await import('./analytics');
      const { backendAnalytics } = analyticsMod;
      backendAnalytics.trackEvent('system', 'stripe_call_success', { idempotencyKey });
    } catch (e) { /* ignore */ }
    // In test environments, remove the reserved key after success so unit tests
    // can re-run the same scenarios without triggering duplicate detection.
    if (process.env.NODE_ENV === 'test') {
      try {
        await removeIdempotencyKey(idempotencyKey);
      } catch (e) {
        (await getLogger()).warn({ err: e, idempotencyKey }, '[stripe-safeguards] Failed to remove idempotency key in test cleanup');
      }
    }
    return result;
  } catch (err) {
    // On Stripe failure remove the stored key so retries are possible
    try {
      const idempoMod = await import('./idempotency-service');
      if (idempoMod && typeof idempoMod.removeIdempotencyKey === 'function') {
        await idempoMod.removeIdempotencyKey(idempotencyKey);
      }
    } catch (remErr) {
      (await getLogger()).error({ remErr, idempotencyKey }, '[stripe-safeguards] Failed to remove idempotency key after error');
    }
    try {
      const analyticsMod = await import('./analytics');
      const { backendAnalytics } = analyticsMod;
      backendAnalytics.trackEvent('system', 'stripe_call_failed', { idempotencyKey, error: err instanceof Error ? err.message : String(err) });
    } catch (e) { /* ignore */ }
    throw err;
  }
}

export default { withStripeIdempotency };
