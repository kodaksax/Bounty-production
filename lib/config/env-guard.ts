/**
 * Environment integrity guard
 * ---------------------------------------------------------------------------
 * Prevents an OTA (`eas update`) bundle from connecting to the WRONG Supabase
 * project — the exact failure that leaked production balances/transactions into
 * the development database.
 *
 * WHY THIS WORKS WHEN EVERYTHING ELSE FAILED:
 *   `EXPO_PUBLIC_*` variables (incl. the Supabase URL) are inlined into the JS
 *   bundle at publish time and CAN be wrong in an OTA update (they were).
 *   `Updates.channel`, by contrast, is baked into the native binary at BUILD
 *   time from the `channel` field of the eas.json build profile. An OTA update
 *   can replace the JS bundle but CANNOT change the channel. So the channel is a
 *   trustworthy, immutable statement of "which environment this binary is."
 *
 *   By comparing the immutable channel against the (mutable) Supabase URL we can
 *   detect "this is the production app, but the bundle is pointing at dev" and
 *   refuse to connect.
 *
 * CHANNEL_TO_SUPABASE_REF is loaded from lib/config/supabase-refs.json — the single
 * source of truth shared with app.config.js. To add/change an environment, edit
 * that JSON file; both the build-time and runtime guards will pick it up automatically.
 */
import * as Updates from 'expo-updates';
import supabaseRefs from './supabase-refs.json';

/** Immutable build channel (from eas.json) -> expected Supabase project ref. */
export const CHANNEL_TO_SUPABASE_REF: Record<string, string> = supabaseRefs.byChannel;

/**
 * Extract the Supabase project ref (first subdomain) from a Supabase URL.
 *
 * Uses a regex instead of `new URL()` to avoid depending on the `URL` global,
 * which is not guaranteed to be present in all React Native / Hermes
 * environments and throws synchronously on non-URL strings in environments
 * where it is available.
 *
 * Matches: https?://<ref>.<rest>
 * Returns: the captured subdomain, or null for any non-matching input.
 */
export function projectRefFromUrl(url?: string | null): string | null {
  if (!url) return null;
  const match = /^https?:\/\/([^./?#]+)\./i.exec(url);
  return match?.[1] || null;
}

/** Read the immutable build channel; null in Expo Go / local dev. */
export function getBuildChannel(): string | null {
  try {
    return (Updates as { channel?: string | null }).channel ?? null;
  } catch {
    return null;
  }
}

export interface EnvIntegrityResult {
  ok: boolean;
  /** Immutable build channel, or null when running locally / in Expo Go. */
  channel: string | null;
  /** Supabase ref the channel is supposed to use. */
  expectedRef: string | null;
  /** Supabase ref the bundle actually resolved to. */
  actualRef: string | null;
  reason?: string;
}

/**
 * Compare the immutable build channel against the resolved Supabase URL.
 * Enforcement only happens for known channels (production/beta/staging/
 * development). Unknown channels and local dev (no channel) pass through so we
 * never brick legitimate sessions.
 */
export function checkEnvironmentIntegrity(supabaseUrl?: string | null): EnvIntegrityResult {
  const channel = getBuildChannel();
  const actualRef = projectRefFromUrl(supabaseUrl);

  // No channel => Expo Go / dev-client / local bundle. Do not enforce.
  if (!channel) {
    return { ok: true, channel, expectedRef: null, actualRef };
  }

  const expectedRef = CHANNEL_TO_SUPABASE_REF[channel] ?? null;

  // Channel we don't have a mapping for — don't hard-block an unexpected channel.
  if (!expectedRef) {
    return { ok: true, channel, expectedRef, actualRef };
  }

  // Fail closed: for a known channel, a null/unparseable actualRef means the
  // URL is missing or malformed — we cannot validate it, so block the connection.
  if (!actualRef) {
    return {
      ok: false,
      channel,
      expectedRef,
      actualRef,
      reason:
        `Build channel "${channel}" requires Supabase project "${expectedRef}", ` +
        `but EXPO_PUBLIC_SUPABASE_URL is missing or could not be parsed. ` +
        `Refusing to connect to an unverifiable environment.`,
    };
  }

  if (actualRef !== expectedRef) {
    return {
      ok: false,
      channel,
      expectedRef,
      actualRef,
      reason:
        `Build channel "${channel}" must use Supabase project "${expectedRef}", ` +
        `but this bundle resolved to "${actualRef}". This usually means an OTA ` +
        `update was published with the wrong environment variables ` +
        `(e.g. \`eas update\` without APP_ENV/--environment). Refusing to connect ` +
        `to the wrong environment.`,
    };
  }

  return { ok: true, channel, expectedRef, actualRef };
}
