/**
 * Marketing install attribution — client integration.
 *
 * Resolves which marketing click produced a user by calling the
 * `marketing-attribute` Edge Function **once per user**, on the first
 * authenticated session after signup/login.
 *
 * Contract (see supabase Edge Function `marketing-attribute`):
 *
 *   POST /functions/v1/marketing-attribute
 *   Authorization: Bearer <user jwt>
 *   Android -> { platform: 'android', install_referrer: '<raw referrer string>' }
 *   iOS     -> { platform: 'ios' }
 *
 *   200 { status: 'attributed', campaign_id, creative_id, platform,
 *         match_method, match_confidence }
 *   200 { status: 'already_attributed', campaign_id, match_method }
 *   200 { status: 'unattributed' }
 *   401/500 { error: ... }
 *
 * Design constraints (all enforced here, not by the caller):
 *
 *  - **Non-blocking / fire-and-forget.** Nothing in this module is awaited by
 *    the auth flow. `performMarketingAttribution()` resolves with an outcome
 *    instead of throwing, so a `void` call can never produce an unhandled
 *    rejection that would surface during login.
 *  - **Idempotent.** A per-user record in AsyncStorage marks the attempt so a
 *    resolved user is never re-sent. An in-flight promise map additionally
 *    collapses concurrent calls (SIGNED_IN and INITIAL_SESSION can both fire
 *    on a cold start) into a single request.
 *  - **Silently fails.** Missing config, an unavailable Play Install Referrer,
 *    an offline device, or a 5xx are all logged and swallowed.
 *
 * Retry policy: a *transport* failure (offline, timeout, 5xx) leaves the record
 * in `pending` and is retried on a later launch, up to MAX_ATTEMPTS. Losing
 * attribution permanently because a user happened to sign in on the subway is
 * worse than three requests. Any *server answer* — including `unattributed` —
 * is terminal: the backend has made its decision and first-touch attribution is
 * immutable, so asking again cannot change it.
 *
 * The attempt counter is persisted *before* the request so a process death
 * mid-flight still counts as an attempt and cannot produce an infinite retry
 * loop across launches.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import { Platform } from 'react-native';

import { config } from '../lib/config';
import { API_BASE_URL } from '../lib/config/api';
import { identify, isPostHogReady } from '../lib/posthog';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { logger } from '../lib/utils/error-logger';

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

/** Terminal server verdicts. */
export type MarketingAttributionStatus = 'attributed' | 'already_attributed' | 'unattributed';

/** What `performMarketingAttribution()` did on this invocation. */
export type MarketingAttributionOutcome =
  /** Server resolved attribution (`attributed` or `unattributed`). */
  | 'completed'
  /** Server reported this user was already attributed on a previous install. */
  | 'already_attributed'
  /** Nothing was sent: already recorded, no session, unsupported platform, or unconfigured. */
  | 'skipped'
  /** Request was sent but did not produce a server verdict. Retryable. */
  | 'failed';

/** Body returned by the `marketing-attribute` Edge Function. */
export interface MarketingAttributionResponse {
  status?: MarketingAttributionStatus | string;
  campaign_id?: string | null;
  creative_id?: string | null;
  utm_source?: string | null;
  platform?: string | null;
  match_method?: string | null;
  match_confidence?: number | null;
  error?: string;
}

export interface PerformMarketingAttributionParams {
  /**
   * Authenticated user id. When omitted it is read from the current Supabase
   * session. Callers that already hold a session (e.g. AuthProvider) should
   * pass it to avoid a `supabase.auth.getSession()` round trip.
   */
  userId?: string;
  /**
   * Pre-obtained JWT. Passing it skips `getSession()` entirely, which matters
   * because that call contends on the supabase-js auth lock (see the
   * `invokePayments` notes in lib/services/stripe-internal.ts).
   */
  accessToken?: string;
}

/** Persisted per-user attempt record. */
interface AttributionRecord {
  /** Schema version, so a future shape change can be detected and reset. */
  v: 1;
  state: 'pending' | 'completed';
  /** Server verdict, present once `state === 'completed'`. */
  status?: MarketingAttributionStatus | string;
  attempts: number;
  updatedAt: string;
}

// ────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────

const LOG_PREFIX = '[Marketing Attribution]';

const FUNCTION_SLUG = 'marketing-attribute';

/** AsyncStorage key prefix. Per-user so account switching still attributes the new user. */
export const MARKETING_ATTRIBUTION_STORAGE_PREFIX = 'marketing_attribution:v1:';

/** Max transport attempts before a user is abandoned permanently. */
const MAX_ATTEMPTS = 3;

/** Play Install Referrer binds to a Play Store service; cap how long that can hang. */
const INSTALL_REFERRER_TIMEOUT_MS = 5_000;

/** Total budget for the Edge Function request. */
const REQUEST_TIMEOUT_MS = 10_000;

/** Guard around `getSession()` — mirrors the 5 s guard used by invokePayments. */
const SESSION_TIMEOUT_MS = 5_000;

// Collapses concurrent invocations for the same user into one request.
const inFlight = new Map<string, Promise<MarketingAttributionOutcome>>();

// ────────────────────────────────────────────────────────────
// Structured logging
// ────────────────────────────────────────────────────────────

type AttributionLogEvent =
  | 'attempted'
  | 'skipped'
  | 'completed'
  | 'already attributed'
  | 'failed';

function log(
  event: AttributionLogEvent,
  context?: Record<string, unknown>,
  level: 'info' | 'warning' = 'info'
): void {
  try {
    const message = `${LOG_PREFIX} ${event}`;
    if (level === 'warning') logger.warning(message, context);
    else logger.info(message, context);
  } catch {
    // Logging must never break a fire-and-forget path.
  }
}

// ────────────────────────────────────────────────────────────
// Persistence
// ────────────────────────────────────────────────────────────

function storageKey(userId: string): string {
  return `${MARKETING_ATTRIBUTION_STORAGE_PREFIX}${userId}`;
}

async function readRecord(userId: string): Promise<AttributionRecord | null> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AttributionRecord;
    // Unknown/legacy shape — treat as "never attempted" rather than trusting it.
    if (!parsed || parsed.v !== 1) return null;
    return parsed;
  } catch {
    // Unreadable storage must not block the attempt; worst case we send once more.
    return null;
  }
}

async function writeRecord(userId: string, record: AttributionRecord): Promise<void> {
  try {
    await AsyncStorage.setItem(storageKey(userId), JSON.stringify(record));
  } catch (e) {
    log('failed', { reason: 'persist_failed', userId, error: e }, 'warning');
  }
}

/**
 * Clears the local attribution record for a user.
 * Exists for tests and manual support/debug flows — the normal lifecycle never
 * calls it, since attribution is deliberately once-per-user-per-device.
 */
export async function clearMarketingAttributionRecord(userId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(storageKey(userId));
  } catch {
    // best effort
  }
  inFlight.delete(userId);
}

// ────────────────────────────────────────────────────────────
// Platform payload
// ────────────────────────────────────────────────────────────

/**
 * Reads the Play Install Referrer via expo-application (the Expo-supported
 * wrapper around Google's Install Referrer API). Android only; returns null on
 * every failure mode — no Play Store on the device, service bind timeout, or a
 * referrer that was never set.
 */
async function getInstallReferrer(): Promise<string | null> {
  if (Platform.OS !== 'android') return null;

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const getter = (Application as { getInstallReferrerAsync?: () => Promise<string> })
      .getInstallReferrerAsync;
    if (typeof getter !== 'function') return null;

    const referrer = await Promise.race<string | null>([
      getter(),
      new Promise<null>(resolve => {
        timer = setTimeout(() => resolve(null), INSTALL_REFERRER_TIMEOUT_MS);
      }),
    ]);

    const trimmed = typeof referrer === 'string' ? referrer.trim() : '';
    return trimmed.length > 0 ? trimmed : null;
  } catch (e) {
    log('skipped', { reason: 'install_referrer_unavailable', error: e });
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function buildPayload(): Promise<Record<string, unknown> | null> {
  if (Platform.OS === 'android') {
    const installReferrer = await getInstallReferrer();
    // Omit rather than send an empty string — the server falls back to
    // IP/device fingerprinting when no referrer is present.
    return installReferrer
      ? { platform: 'android', install_referrer: installReferrer }
      : { platform: 'android' };
  }

  if (Platform.OS === 'ios') {
    // iOS has no install referrer; the server resolves probabilistically.
    return { platform: 'ios' };
  }

  // web / unsupported — there is no install to attribute.
  return null;
}

// ────────────────────────────────────────────────────────────
// Session + transport
// ────────────────────────────────────────────────────────────

async function resolveSession(
  params: PerformMarketingAttributionParams
): Promise<{ userId: string; accessToken: string } | null> {
  if (params.userId && params.accessToken) {
    return { userId: params.userId, accessToken: params.accessToken };
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      supabase.auth.getSession(),
      new Promise<null>(resolve => {
        timer = setTimeout(() => resolve(null), SESSION_TIMEOUT_MS);
      }),
    ]);

    const session = (result as { data?: { session?: unknown } } | null)?.data?.session as
      | { access_token?: string; user?: { id?: string } }
      | null
      | undefined;

    const userId = params.userId ?? session?.user?.id;
    const accessToken = params.accessToken ?? session?.access_token;
    if (!userId || !accessToken) return null;

    return { userId, accessToken };
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * POSTs to the Edge Function directly rather than via
 * `supabase.functions.invoke()`, which internally calls `getSession()` and can
 * hang on the supabase-js auth lock during concurrent auth events — exactly the
 * moment this runs. See lib/services/stripe-internal.ts for the full write-up.
 */
async function postAttribution(
  accessToken: string,
  payload: Record<string, unknown>
): Promise<MarketingAttributionResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${API_BASE_URL}/${FUNCTION_SLUG}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: config.supabase.anonKey,
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const text = await response.text().catch(() => '');
    let body: MarketingAttributionResponse = {};
    try {
      body = text ? (JSON.parse(text) as MarketingAttributionResponse) : {};
    } catch {
      body = {};
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}${body.error ? ` (${body.error})` : ''}`);
    }

    return body;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ────────────────────────────────────────────────────────────
// PostHog
// ────────────────────────────────────────────────────────────

function identifyWithAttribution(userId: string, body: MarketingAttributionResponse): void {
  try {
    if (!isPostHogReady()) return;

    // Only forward properties the server actually resolved — sending nulls
    // would overwrite an existing person property with an empty value.
    const properties: Record<string, unknown> = {};
    if (body.campaign_id != null) properties.campaign_id = body.campaign_id;
    if (body.creative_id != null) properties.creative_id = body.creative_id;
    if (body.utm_source != null) properties.utm_source = body.utm_source;
    if (body.match_method != null) properties.match_method = body.match_method;
    if (body.match_confidence != null) properties.match_confidence = body.match_confidence;

    if (Object.keys(properties).length === 0) return;

    identify(userId, properties);
  } catch (e) {
    log('failed', { reason: 'posthog_identify_failed', error: e }, 'warning');
  }
}

// ────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────

/**
 * Attributes the current user to a marketing click, exactly once.
 *
 * Safe to call on every authenticated session — repeat calls short-circuit on
 * the persisted record. Never throws and never blocks: resolves to an outcome
 * so callers can `void performMarketingAttribution(...)`.
 */
export async function performMarketingAttribution(
  params: PerformMarketingAttributionParams = {}
): Promise<MarketingAttributionOutcome> {
  try {
    if (!isSupabaseConfigured) {
      log('skipped', { reason: 'supabase_not_configured' });
      return 'skipped';
    }

    const session = await resolveSession(params);
    if (!session) {
      log('skipped', { reason: 'no_authenticated_session' });
      return 'skipped';
    }

    const { userId, accessToken } = session;

    const existing = inFlight.get(userId);
    if (existing) {
      log('skipped', { reason: 'already_in_flight', userId });
      return existing;
    }

    const run = attribute(userId, accessToken).finally(() => {
      inFlight.delete(userId);
    });
    inFlight.set(userId, run);
    return await run;
  } catch (e) {
    // Belt and braces: this function is invoked fire-and-forget from the auth
    // lifecycle and must never reject.
    log('failed', { reason: 'unexpected_error', error: e }, 'warning');
    return 'failed';
  }
}

async function attribute(
  userId: string,
  accessToken: string
): Promise<MarketingAttributionOutcome> {
  const record = await readRecord(userId);

  if (record?.state === 'completed') {
    log('skipped', { reason: 'already_recorded', userId, status: record.status });
    return 'skipped';
  }

  const attempts = record?.attempts ?? 0;
  if (attempts >= MAX_ATTEMPTS) {
    log('skipped', { reason: 'max_attempts_reached', userId, attempts });
    return 'skipped';
  }

  const payload = await buildPayload();
  if (!payload) {
    log('skipped', { reason: 'unsupported_platform', userId, platform: Platform.OS });
    return 'skipped';
  }

  const attempt = attempts + 1;

  // Persist the attempt BEFORE the request so a crash mid-flight still counts
  // and cannot produce an unbounded retry loop across launches.
  await writeRecord(userId, {
    v: 1,
    state: 'pending',
    attempts: attempt,
    updatedAt: new Date().toISOString(),
  });

  log('attempted', {
    userId,
    attempt,
    platform: payload.platform,
    hasInstallReferrer: 'install_referrer' in payload,
  });

  let body: MarketingAttributionResponse;
  try {
    body = await postAttribution(accessToken, payload);
  } catch (e) {
    // Offline, timeout, 4xx/5xx — leave the record `pending` so a later launch
    // can retry within the attempt budget.
    log(
      'failed',
      {
        userId,
        attempt,
        attemptsRemaining: Math.max(0, MAX_ATTEMPTS - attempt),
        error: e instanceof Error ? e.message : e,
      },
      'warning'
    );
    return 'failed';
  }

  const status = body.status;

  if (status !== 'attributed' && status !== 'already_attributed' && status !== 'unattributed') {
    // 200 with an unrecognised body — treat as a transport-level failure so the
    // attempt budget still applies rather than silently marking the user done.
    log('failed', { userId, attempt, reason: 'unexpected_response', status }, 'warning');
    return 'failed';
  }

  // Any server verdict is terminal.
  await writeRecord(userId, {
    v: 1,
    state: 'completed',
    status,
    attempts: attempt,
    updatedAt: new Date().toISOString(),
  });

  identifyWithAttribution(userId, body);

  if (status === 'already_attributed') {
    log('already attributed', {
      userId,
      campaign_id: body.campaign_id ?? null,
      match_method: body.match_method ?? null,
    });
    return 'already_attributed';
  }

  log('completed', {
    userId,
    status,
    campaign_id: body.campaign_id ?? null,
    creative_id: body.creative_id ?? null,
    match_method: body.match_method ?? null,
    match_confidence: body.match_confidence ?? null,
  });
  return 'completed';
}

export default performMarketingAttribution;
