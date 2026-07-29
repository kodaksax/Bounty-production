/**
 * Unit tests for formatCurrencyCents — the formatter used for every balance
 * sourced from Stripe. Stripe reports money in minor units, so these tests
 * pin the cents→display conversion, including the zero-decimal currency case
 * that a naive `/100` would get wrong.
 */

import { formatCurrencyCents } from '../../../lib/utils';

describe('formatCurrencyCents', () => {
  it('formats USD cents as dollars', () => {
    expect(formatCurrencyCents(1250, 'USD', 'en-US')).toBe('$12.50');
  });

  it('adds thousands separators', () => {
    expect(formatCurrencyCents(1234567, 'USD', 'en-US')).toBe('$12,345.67');
  });

  it('formats zero', () => {
    expect(formatCurrencyCents(0, 'USD', 'en-US')).toBe('$0.00');
  });

  it('formats a negative balance (Stripe can report one after a dispute)', () => {
    expect(formatCurrencyCents(-500, 'USD', 'en-US')).toBe('-$5.00');
  });

  it('does not lose precision on amounts that float math would round badly', () => {
    // 1/100 of these is not exactly representable in binary floating point;
    // the result must still be exact to the cent.
    expect(formatCurrencyCents(1999, 'USD', 'en-US')).toBe('$19.99');
    expect(formatCurrencyCents(70, 'USD', 'en-US')).toBe('$0.70');
    expect(formatCurrencyCents(2900, 'USD', 'en-US')).toBe('$29.00');
  });

  it('accepts a lowercase currency code (Stripe returns lowercase)', () => {
    expect(formatCurrencyCents(1250, 'usd', 'en-US')).toBe('$12.50');
  });

  it('respects the requested locale for grouping and symbol placement', () => {
    const de = formatCurrencyCents(1234567, 'EUR', 'de-DE');
    // de-DE uses "." for grouping, "," for decimals, trailing symbol.
    expect(de).toContain('12.345,67');
    expect(de).toContain('€');
  });

  it('treats zero-decimal currencies as already being in major units', () => {
    // JPY has no minor unit: 1250 yen is ¥1,250, not ¥12.50.
    expect(formatCurrencyCents(1250, 'JPY', 'en-US')).toBe('¥1,250');
  });
});
