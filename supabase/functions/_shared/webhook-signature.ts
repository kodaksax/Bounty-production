// Stripe webhook signature verification — multi-secret.
//
// WHY MULTI-SECRET (incident 2026-09-02):
// Bounty has TWO enabled Stripe webhook endpoints pointed at the SAME URL
// (`/functions/v1/webhooks`):
//
//   we_1SrY3y…  platform endpoint (application: null, managed_by stripe-sync)
//               payment_intent.*, charge.*, setup_intent.*, customer.*,
//               refund.*, checkout.session.*, platform payout.*
//   we_1TxbWt…  CONNECT endpoint (application: ca_TQQx…)
//               payout.*, transfer.*, account.updated, capability.updated,
//               balance.available — i.e. every connected-account event
//
// Every Stripe endpoint has its OWN signing secret. The function only ever read
// `STRIPE_WEBHOOK_SECRET`, so exactly one of the two endpoints could ever
// verify. The Connect endpoint's deliveries were rejected 400 at a steady
// ~25/hour, which is precisely why no `payout.*` / `transfer.*` /
// `account.updated` event had been processed since 2026-08-10 — the gap
// diagnosed in docs/withdrawals/17-payout-webhook-gap-2026-09-01.md as
// "check the Stripe Dashboard subscription". The subscription was fine; the
// signature was being checked against the wrong secret.
//
// Trying each configured secret in turn is also what makes secret ROTATION
// safe: during a roll, both the old and new secret are accepted.
//
// This stays fail-closed: a payload that matches NO configured secret is
// rejected, exactly as before.

/** Env vars consulted for signing secrets, in the order they are tried. */
export const WEBHOOK_SECRET_ENV_VARS = [
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_CONNECT_WEBHOOK_SECRET',
  'STRIPE_WEBHOOK_SECRET_SECONDARY',
] as const;

/**
 * Collects every configured signing secret.
 *
 * Each env var may itself hold a comma- or whitespace-separated list, so a
 * deployment can add a rotation secret without a code change. Order is
 * preserved and duplicates are dropped so the common case still costs exactly
 * one HMAC.
 */
export function collectWebhookSecrets(read: (name: string) => string | undefined): string[] {
  const secrets: string[] = [];
  const seen = new Set<string>();
  for (const name of WEBHOOK_SECRET_ENV_VARS) {
    const raw = read(name);
    if (!raw) continue;
    for (const candidate of raw.split(/[,\s]+/)) {
      const secret = candidate.trim();
      if (!secret || seen.has(secret)) continue;
      seen.add(secret);
      secrets.push(secret);
    }
  }
  return secrets;
}

function hex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function computeHmacSha256(key: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return hex(await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(data)));
}

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let res = 0;
  for (let i = 0; i < a.length; i++) {
    res |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return res === 0;
}

/** Parsed `Stripe-Signature` header: `t=<unix>,v1=<hex>[,v1=<hex>…]`. */
export function parseSignatureHeader(
  header: string | null
): { timestamp: number; signatures: string[] } | null {
  if (!header) return null;
  const values: Record<string, string[]> = {};
  for (const part of header.split(',')) {
    const [key, value] = part.trim().split('=');
    if (!key || !value) continue;
    (values[key] ??= []).push(value);
  }
  const t = values['t']?.[0];
  const signatures = values['v1'] ?? [];
  if (!t || signatures.length === 0) return null;
  const timestamp = Number(t);
  if (!Number.isFinite(timestamp)) return null;
  return { timestamp, signatures };
}

export type SignatureVerification =
  | { verified: true; secretIndex: number }
  | { verified: false; reason: 'malformed_header' | 'no_secrets' | 'timestamp_skew' | 'no_match' };

/**
 * Verifies a raw webhook body against every configured secret.
 *
 * The timestamp-skew check is evaluated BEFORE any secret is tried, so a
 * replayed-but-genuinely-signed payload is rejected on its age regardless of
 * which endpoint signed it. (The previous implementation checked skew only
 * after a signature matched, inside the match branch — same outcome for a
 * single secret, but with several secrets it would have made the rejection
 * reason depend on secret ordering.)
 *
 * `toleranceSeconds` defaults to Stripe's recommended 5 minutes. This is the
 * replay-attack window: a captured request cannot be re-sent after it expires.
 */
export async function verifyStripeSignature(
  payload: string,
  header: string | null,
  secrets: string[],
  opts: { toleranceSeconds?: number; nowSeconds?: number } = {}
): Promise<SignatureVerification> {
  if (secrets.length === 0) return { verified: false, reason: 'no_secrets' };

  const parsed = parseSignatureHeader(header);
  if (!parsed) return { verified: false, reason: 'malformed_header' };

  const tolerance = opts.toleranceSeconds ?? 5 * 60;
  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - parsed.timestamp) > tolerance) {
    return { verified: false, reason: 'timestamp_skew' };
  }

  const signedPayload = `${parsed.timestamp}.${payload}`;
  for (let i = 0; i < secrets.length; i++) {
    const expected = await computeHmacSha256(secrets[i], signedPayload);
    for (const candidate of parsed.signatures) {
      if (safeCompare(candidate, expected)) {
        return { verified: true, secretIndex: i };
      }
    }
  }
  return { verified: false, reason: 'no_match' };
}
