/**
 * The client's platform-fee constant is the number the app *tells users* they
 * will be charged — the FAQ, the poster's price step, the hunter's earnings
 * card and the payout receipt all derive their copy from it. It previously
 * drifted to 10% while the server deducted 5%, so every one of those surfaces
 * quoted double the real fee.
 *
 * These tests pin the rate to the server's default and pin the arithmetic to
 * the server's rounding, so the two can't silently diverge again.
 */
import {
  PLATFORM_FEE_PERCENT,
  PLATFORM_FEE_RATE,
  PLATFORM_FEE_DISPLAY,
  calculateHunterEarnings,
  effectiveFeePercent,
} from '../../../lib/constants/fees';

describe('platform fee constants', () => {
  it('matches the server default (PLATFORM_FEE_PERCENT env, default 5)', () => {
    // supabase/functions/wallet/index.ts, supabase/functions/bounty-payments/index.ts
    // and services/api/src/services/completion-release-service.ts all default to 5.
    expect(PLATFORM_FEE_PERCENT).toBe(5);
    expect(PLATFORM_FEE_RATE).toBeCloseTo(0.05, 10);
  });

  it('renders a whole percent without a trailing decimal', () => {
    expect(PLATFORM_FEE_DISPLAY).toBe('5%');
  });
});

describe('calculateHunterEarnings', () => {
  it('splits a bounty into gross, fee and take-home', () => {
    expect(calculateHunterEarnings(100)).toEqual({ gross: 100, fee: 5, net: 95 });
    expect(calculateHunterEarnings(40)).toEqual({ gross: 40, fee: 2, net: 38 });
  });

  it('rounds the fee to cents the way the server does, so net always reconciles', () => {
    // Server: round2((amount * PERCENT) / 100), then amount - fee.
    const { gross, fee, net } = calculateHunterEarnings(10.99);
    expect(fee).toBeCloseTo(0.55, 10);
    expect(net).toBeCloseTo(10.44, 10);
    expect(Math.round((fee + net) * 100) / 100).toBe(gross);
  });

  it('prefers the authoritative fee from a settled release over the estimate', () => {
    // The server rate is env-configurable, so a receipt must show what actually
    // moved rather than recomputing from the client constant.
    expect(calculateHunterEarnings(100, 12.5)).toEqual({ gross: 100, fee: 12.5, net: 87.5 });
  });

  it('is inert for missing, zero or negative amounts (for-honor bounties)', () => {
    for (const amount of [null, undefined, 0, -20, Number.NaN]) {
      expect(calculateHunterEarnings(amount as number)).toEqual({ gross: 0, fee: 0, net: 0 });
    }
  });

  it('never reports a negative take-home even if a fee exceeds the amount', () => {
    expect(calculateHunterEarnings(10, 25).net).toBe(0);
  });
});

describe('effectiveFeePercent', () => {
  it('reports the rate actually applied to a release', () => {
    expect(effectiveFeePercent(100, 5)).toBe(5);
    expect(effectiveFeePercent(100, 12.5)).toBe(12.5);
  });

  it('falls back to the configured rate when there is no gross to divide by', () => {
    expect(effectiveFeePercent(0, 0)).toBe(PLATFORM_FEE_PERCENT);
  });
});
