/**
 * Live/test mode guard for the Stripe webhook.
 *
 * Stripe documents that a live Connect webhook endpoint also receives
 * TEST-mode events from connected accounts. Production stored and processed 19
 * test-mode events (2026-02..2026-07) because nothing compared `livemode`
 * against the deployment. A test-mode wallet_deposit event naming a real user
 * would have credited real balance.
 */
import * as fs from 'fs';
import * as path from 'path';
import { eventModeMatchesKey } from '../../supabase/functions/_shared/webhook-signature';

describe('eventModeMatchesKey', () => {
  it.each([
    ['sk_live_x', true, true],
    ['rk_live_x', true, true],
    ['sk_test_x', false, true],
    ['rk_test_x', false, true],
  ])('%s accepts livemode=%s', (key, livemode, expected) => {
    expect(eventModeMatchesKey(livemode, key).matches).toBe(expected);
  });

  it('REGRESSION: a live deployment rejects a test-mode event', () => {
    expect(eventModeMatchesKey(false, 'sk_live_x')).toEqual({ matches: false, keyMode: 'live' });
  });

  it('a test deployment rejects a live-mode event', () => {
    expect(eventModeMatchesKey(true, 'sk_test_x')).toEqual({ matches: false, keyMode: 'test' });
  });

  it('does not block when the key format or livemode is unrecognised', () => {
    expect(eventModeMatchesKey(false, 'weird').matches).toBe(true);
    expect(eventModeMatchesKey(undefined, 'sk_live_x').matches).toBe(true);
  });
});

describe('webhooks/index.ts wiring (source-level)', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../../supabase/functions/webhooks/index.ts'),
    'utf8'
  );

  it('checks the mode after signature verification and BEFORE claiming the event', () => {
    const verify = src.indexOf('verifyStripeSignature(rawBody');
    const mode = src.indexOf('eventModeMatchesKey(');
    const claim = src.indexOf("supabase.rpc('claim_stripe_event'");
    expect(verify).toBeGreaterThan(-1);
    expect(mode).toBeGreaterThan(verify);
    expect(claim).toBeGreaterThan(mode);
  });

  it('acknowledges a mismatched event with 200 so Stripe does not retry it', () => {
    const start = src.indexOf('if (!modeCheck.matches)');
    const ret = src.indexOf('return jsonResponse', start);
    const block = src.slice(start, src.indexOf('\n', ret));
    expect(block).toMatch(/return jsonResponse\(\{ received: true, ignored: 'livemode_mismatch' \}\)/);
  });
});
