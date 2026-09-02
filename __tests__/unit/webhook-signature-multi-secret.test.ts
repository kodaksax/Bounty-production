/**
 * Behavioural tests for Stripe webhook signature verification.
 *
 * REGRESSION TARGET: the 2026-09-02 Connect webhook outage. Two enabled Stripe
 * endpoints post to the same `/functions/v1/webhooks` URL — the platform
 * endpoint and the Connect endpoint (`application: ca_…`) — and each signs with
 * its OWN secret. The function read only `STRIPE_WEBHOOK_SECRET`, so every
 * Connect delivery (`payout.*`, `transfer.*`, `account.updated`) was rejected
 * 400 at ~25/hour. That, not a missing Dashboard subscription, is why no
 * connected-account payout event had been processed since 2026-08-10 and why
 * standard withdrawals stranded in `pending`.
 *
 * These exercise the real exported logic in
 * supabase/functions/_shared/webhook-signature.ts — the module the webhooks
 * Edge Function imports — so the guarantees below are properties of the
 * running code, not of its text.
 */
import { createHmac } from 'crypto';
import {
  WEBHOOK_SECRET_ENV_VARS,
  collectWebhookSecrets,
  parseSignatureHeader,
  verifyStripeSignature,
} from '../../supabase/functions/_shared/webhook-signature';

const PLATFORM_SECRET = 'whsec_platform_endpoint_we_1SrY3y';
const CONNECT_SECRET = 'whsec_connect_endpoint_we_1TxbWt';
const ROTATION_SECRET = 'whsec_rotation_key';

const NOW = 1_788_400_000;
const BODY = JSON.stringify({ id: 'evt_test', type: 'payout.paid' });

/** Builds a genuine `Stripe-Signature` header the way Stripe does. */
function sign(body: string, secret: string, timestamp = NOW): string {
  const v1 = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${v1}`;
}

function envReader(vars: Record<string, string | undefined>) {
  return (name: string) => vars[name];
}

describe('collectWebhookSecrets', () => {
  it('returns nothing when no secret is configured', () => {
    expect(collectWebhookSecrets(envReader({}))).toEqual([]);
  });

  it('reads the primary secret', () => {
    expect(collectWebhookSecrets(envReader({ STRIPE_WEBHOOK_SECRET: PLATFORM_SECRET }))).toEqual([
      PLATFORM_SECRET,
    ]);
  });

  it('reads the Connect secret alongside the platform secret, primary first', () => {
    expect(
      collectWebhookSecrets(
        envReader({
          STRIPE_WEBHOOK_SECRET: PLATFORM_SECRET,
          STRIPE_CONNECT_WEBHOOK_SECRET: CONNECT_SECRET,
        })
      )
    ).toEqual([PLATFORM_SECRET, CONNECT_SECRET]);
  });

  it('splits a comma-separated list inside one variable', () => {
    expect(
      collectWebhookSecrets(
        envReader({ STRIPE_WEBHOOK_SECRET: `${PLATFORM_SECRET}, ${CONNECT_SECRET}` })
      )
    ).toEqual([PLATFORM_SECRET, CONNECT_SECRET]);
  });

  it('ignores blank entries and surrounding whitespace', () => {
    expect(
      collectWebhookSecrets(envReader({ STRIPE_WEBHOOK_SECRET: `  ${PLATFORM_SECRET} ,, ` }))
    ).toEqual([PLATFORM_SECRET]);
  });

  it('deduplicates a secret configured in two variables', () => {
    expect(
      collectWebhookSecrets(
        envReader({
          STRIPE_WEBHOOK_SECRET: PLATFORM_SECRET,
          STRIPE_CONNECT_WEBHOOK_SECRET: PLATFORM_SECRET,
        })
      )
    ).toEqual([PLATFORM_SECRET]);
  });

  it('consults exactly the documented variables', () => {
    expect(WEBHOOK_SECRET_ENV_VARS).toEqual([
      'STRIPE_WEBHOOK_SECRET',
      'STRIPE_CONNECT_WEBHOOK_SECRET',
      'STRIPE_WEBHOOK_SECRET_SECONDARY',
    ]);
  });
});

describe('parseSignatureHeader', () => {
  it('rejects a missing header', () => {
    expect(parseSignatureHeader(null)).toBeNull();
  });

  it('rejects a header with no v1 signature', () => {
    expect(parseSignatureHeader(`t=${NOW}`)).toBeNull();
  });

  it('rejects a header with a non-numeric timestamp', () => {
    expect(parseSignatureHeader('t=not-a-number,v1=abc')).toBeNull();
  });

  it('keeps every v1 signature during a secret roll', () => {
    const parsed = parseSignatureHeader(`t=${NOW},v1=aaa,v1=bbb`);
    expect(parsed).toEqual({ timestamp: NOW, signatures: ['aaa', 'bbb'] });
  });
});

describe('verifyStripeSignature — the outage', () => {
  it('accepts a platform-endpoint delivery', async () => {
    const result = await verifyStripeSignature(
      BODY,
      sign(BODY, PLATFORM_SECRET),
      [PLATFORM_SECRET, CONNECT_SECRET],
      { nowSeconds: NOW }
    );
    expect(result).toEqual({ verified: true, secretIndex: 0 });
  });

  it('accepts a Connect-endpoint delivery signed with the second secret', async () => {
    const result = await verifyStripeSignature(
      BODY,
      sign(BODY, CONNECT_SECRET),
      [PLATFORM_SECRET, CONNECT_SECRET],
      { nowSeconds: NOW }
    );
    expect(result).toEqual({ verified: true, secretIndex: 1 });
  });

  it('REPRODUCES THE OUTAGE: a Connect delivery is rejected when only the platform secret is configured', async () => {
    const result = await verifyStripeSignature(BODY, sign(BODY, CONNECT_SECRET), [PLATFORM_SECRET], {
      nowSeconds: NOW,
    });
    expect(result).toEqual({ verified: false, reason: 'no_match' });
  });

  it('accepts either key mid-rotation', async () => {
    const secrets = [PLATFORM_SECRET, CONNECT_SECRET, ROTATION_SECRET];
    for (const [index, secret] of secrets.entries()) {
      await expect(
        verifyStripeSignature(BODY, sign(BODY, secret), secrets, { nowSeconds: NOW })
      ).resolves.toEqual({ verified: true, secretIndex: index });
    }
  });
});

describe('verifyStripeSignature — fails closed', () => {
  it('rejects a forged signature', async () => {
    const result = await verifyStripeSignature(
      BODY,
      `t=${NOW},v1=${'0'.repeat(64)}`,
      [PLATFORM_SECRET, CONNECT_SECRET],
      { nowSeconds: NOW }
    );
    expect(result).toEqual({ verified: false, reason: 'no_match' });
  });

  it('rejects a body tampered with after signing', async () => {
    const header = sign(BODY, PLATFORM_SECRET);
    const tampered = JSON.stringify({ id: 'evt_test', type: 'payout.paid', amount: 999999 });
    const result = await verifyStripeSignature(tampered, header, [PLATFORM_SECRET], {
      nowSeconds: NOW,
    });
    expect(result).toEqual({ verified: false, reason: 'no_match' });
  });

  it('rejects a signature lifted onto a different timestamp', async () => {
    const v1 = createHmac('sha256', PLATFORM_SECRET).update(`${NOW}.${BODY}`).digest('hex');
    const result = await verifyStripeSignature(BODY, `t=${NOW + 1},v1=${v1}`, [PLATFORM_SECRET], {
      nowSeconds: NOW + 1,
    });
    expect(result).toEqual({ verified: false, reason: 'no_match' });
  });

  it('rejects everything when no secret is configured, rather than defaulting open', async () => {
    const result = await verifyStripeSignature(BODY, sign(BODY, PLATFORM_SECRET), [], {
      nowSeconds: NOW,
    });
    expect(result).toEqual({ verified: false, reason: 'no_secrets' });
  });

  it('rejects a malformed header', async () => {
    const result = await verifyStripeSignature(BODY, 'garbage', [PLATFORM_SECRET], {
      nowSeconds: NOW,
    });
    expect(result).toEqual({ verified: false, reason: 'malformed_header' });
  });
});

describe('verifyStripeSignature — replay window', () => {
  it('rejects a genuinely signed payload replayed after the tolerance', async () => {
    const header = sign(BODY, PLATFORM_SECRET, NOW);
    const result = await verifyStripeSignature(BODY, header, [PLATFORM_SECRET], {
      nowSeconds: NOW + 301,
    });
    expect(result).toEqual({ verified: false, reason: 'timestamp_skew' });
  });

  it('rejects a payload timestamped too far in the future', async () => {
    const header = sign(BODY, PLATFORM_SECRET, NOW + 301);
    const result = await verifyStripeSignature(BODY, header, [PLATFORM_SECRET], {
      nowSeconds: NOW,
    });
    expect(result).toEqual({ verified: false, reason: 'timestamp_skew' });
  });

  it('accepts a delivery inside the tolerance', async () => {
    const header = sign(BODY, PLATFORM_SECRET, NOW);
    await expect(
      verifyStripeSignature(BODY, header, [PLATFORM_SECRET], { nowSeconds: NOW + 299 })
    ).resolves.toEqual({ verified: true, secretIndex: 0 });
  });

  it('reports skew independently of which secret would have matched', async () => {
    // Skew is evaluated before any secret is tried, so an expired Connect
    // delivery reports its age rather than a misleading `no_match`.
    const header = sign(BODY, CONNECT_SECRET, NOW);
    const result = await verifyStripeSignature(
      BODY,
      header,
      [PLATFORM_SECRET, CONNECT_SECRET],
      { nowSeconds: NOW + 3600 }
    );
    expect(result).toEqual({ verified: false, reason: 'timestamp_skew' });
  });
});
