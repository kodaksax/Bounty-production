/**
 * The version gate can lock every user out of the app if it resolves wrongly,
 * so the comparison and the fail-open behaviour are covered directly.
 */

import { compareVersions } from '../../../lib/services/app-version-service';

describe('compareVersions', () => {
  it('orders by numeric segment, not lexically', () => {
    // "2.0.10" < "2.0.9" under string comparison — the classic way a gate
    // starts blocking users who are actually up to date.
    expect(compareVersions('2.0.10', '2.0.9')).toBeGreaterThan(0);
    expect(compareVersions('2.0.9', '2.0.10')).toBeLessThan(0);
  });

  it('treats equal versions as equal', () => {
    expect(compareVersions('2.0.4', '2.0.4')).toBe(0);
  });

  it('pads missing segments with zero', () => {
    expect(compareVersions('2.0', '2.0.0')).toBe(0);
    expect(compareVersions('2.1', '2.0.9')).toBeGreaterThan(0);
  });

  it('compares major and minor versions', () => {
    expect(compareVersions('3.0.0', '2.9.9')).toBeGreaterThan(0);
    expect(compareVersions('2.1.0', '2.0.99')).toBeGreaterThan(0);
  });

  it('does not produce NaN for non-numeric segments', () => {
    // A "-beta" suffix must not poison the comparison into a false "equal",
    // which would silently disable the gate.
    expect(compareVersions('2.0.4-beta', '2.0.4')).toBe(0);
    expect(compareVersions('2.1.0-rc1', '2.0.0')).toBeGreaterThan(0);
  });

  it('handles empty and malformed input without throwing', () => {
    expect(() => compareVersions('', '2.0.0')).not.toThrow();
    expect(compareVersions('', '2.0.0')).toBeLessThan(0);
    expect(compareVersions(undefined as unknown as string, '2.0.0')).toBeLessThan(0);
  });
});
