/**
 * Platform fee parity: every place that computes the 5% fee must agree to the
 * cent, for every amount a poster can name.
 *
 * Defect guarded (2026-11-04 Stripe dev-workflow audit): v1 wallet /release and
 * v2 bounty-payments /release computed the fee in floating-point dollars, which
 * rounds half-cents DOWN — $11.50 credited a $0.57 fee while v3 and the web
 * receipt (integer cents) said $0.58. 286 amounts in $0.01–$1,000 disagreed on
 * the server, and the client estimate disagreed on 102 more. The hunter was
 * shown one net and credited another.
 *
 * All paths now use supabase/functions/_shared/platform-fee.ts (server) and the
 * same arithmetic in lib/constants/fees.ts (client).
 */
import * as fs from 'fs';
import * as path from 'path';
import { calculateHunterEarnings, PLATFORM_FEE_PERCENT } from '../../lib/constants/fees';
import {
  DEFAULT_PLATFORM_FEE_PERCENT,
  platformFeePercentFromEnv,
  splitPlatformFeeCents,
  splitPlatformFeeDollars,
} from '../../supabase/functions/_shared/platform-fee';
import { hunterNetCents, platformFeePercent } from '../../supabase/functions/web-account/logic';

describe('one fee rate everywhere (owner decision 2026-11-04: 8%)', () => {
  // Production deducted 8% (PLATFORM_FEE_PERCENT secret) from 2026-07-12 while
  // the app quoted 5%. The rate users are shown must be the rate deducted.
  it('client constant, server default and web receipt default are all 8', () => {
    expect(PLATFORM_FEE_PERCENT).toBe(8);
    expect(DEFAULT_PLATFORM_FEE_PERCENT).toBe(PLATFORM_FEE_PERCENT);
    expect(platformFeePercentFromEnv(undefined)).toBe(PLATFORM_FEE_PERCENT);
    expect(platformFeePercent(undefined)).toBe(PLATFORM_FEE_PERCENT);
  });

  it('an explicit secret still wins', () => {
    expect(platformFeePercentFromEnv('10')).toBe(10);
    expect(platformFeePercent('10')).toBe(10);
  });

  it('no release endpoint keeps a hardcoded 5% fallback', () => {
    for (const f of [
      'supabase/functions/wallet/index.ts',
      'supabase/functions/bounty-payments/index.ts',
    ]) {
      const src = fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');
      expect(src).not.toMatch(/PLATFORM_FEE_PERCENT'\) \?\? '5'/);
      expect(src).toContain('platformFeePercentFromEnv(');
    }
  });
});

describe('splitPlatformFeeCents / splitPlatformFeeDollars', () => {
  it('REGRESSION: rounds a half-cent fee up ($11.50 → $0.58, not $0.57)', () => {
    expect(splitPlatformFeeDollars(11.5, 5)).toMatchObject({ platformFee: 0.58, hunterAmount: 10.92 });
    expect(splitPlatformFeeDollars(20.5, 5)).toMatchObject({ platformFee: 1.03, hunterAmount: 19.47 });
  });

  it('handles round numbers and zero', () => {
    expect(splitPlatformFeeDollars(100, 5)).toMatchObject({ platformFee: 5, hunterAmount: 95 });
    expect(splitPlatformFeeCents(0, 5)).toEqual({ amountCents: 0, feeCents: 0, hunterCents: 0 });
  });

  it('fee + net always equals the amount exactly, in cents', () => {
    for (let c = 1; c <= 100_000; c++) {
      const s = splitPlatformFeeCents(c, 5);
      if (s.feeCents + s.hunterCents !== c || s.feeCents < 0 || s.hunterCents < 0) {
        throw new Error(`bad split at ${c}¢: ${JSON.stringify(s)}`);
      }
    }
  });

  it('returns dollars with no float residue (exactly two decimals)', () => {
    for (let c = 1; c <= 100_000; c += 7) {
      const { platformFee, hunterAmount } = splitPlatformFeeDollars(c / 100, 5);
      expect(Math.round(platformFee * 100) / 100).toBe(platformFee);
      expect(Math.round(hunterAmount * 100) / 100).toBe(hunterAmount);
    }
  });
});

describe('parity across server, web receipt and client estimate ($0.01 – $1,000)', () => {
  it('REGRESSION: all four computations agree on every amount', () => {
    const mismatches: string[] = [];
    for (let c = 1; c <= 100_000; c++) {
      const dollars = c / 100;
      const server = splitPlatformFeeDollars(dollars, PLATFORM_FEE_PERCENT);
      const v3 = splitPlatformFeeCents(c, PLATFORM_FEE_PERCENT);
      const receiptNet = hunterNetCents(dollars, PLATFORM_FEE_PERCENT);
      const client = calculateHunterEarnings(dollars);
      const clientFeeCents = Math.round(client.fee * 100);
      const clientNetCents = Math.round(client.net * 100);
      if (
        server.feeCents !== v3.feeCents ||
        server.hunterCents !== receiptNet ||
        clientFeeCents !== v3.feeCents ||
        clientNetCents !== v3.hunterCents
      ) {
        mismatches.push(`$${dollars.toFixed(2)}`);
        if (mismatches.length >= 10) break;
      }
    }
    expect(mismatches).toEqual([]);
  });
});

describe('release endpoints use the shared split (source-level)', () => {
  const read = (p: string) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
  const floatFee = /Math\.round\(\(\(\w+ \* PLATFORM_FEE_PERCENT\) \/ 100\) \* 100\) \/ 100/;

  it.each([
    ['supabase/functions/wallet/index.ts', 'splitPlatformFeeDollars('],
    ['supabase/functions/bounty-payments/index.ts', 'splitPlatformFeeDollars('],
    ['supabase/functions/bounty-payments/index.ts', 'splitPlatformFeeCents('],
  ])('%s calls %s and has no dollar-float fee left', (file, call) => {
    const src = read(file);
    expect(src).toContain(call);
    expect(src).not.toMatch(floatFee);
  });
});
