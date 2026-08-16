// Unit tests for the pure comparison logic behind the production OTA
// publish guardrail (scripts/eas-update-guardrails.js). See
// docs/deployment/EAS_UPDATE_INCIDENT_2026-08-11.md for the incident this
// guardrail exists to prevent: an OTA update silently reaching a native
// build whose fingerprint no longer matched the JS being published.

// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
const { evaluateCompatibility, parseArgs } = require('../../scripts/eas-update-guardrails.js');

describe('eas-update-guardrails: evaluateCompatibility', () => {
  it('reports compatible when the local fingerprint matches the latest build', () => {
    const result = evaluateCompatibility({
      platform: 'ios',
      latestBuild: { id: 'build-1', gitCommitHash: 'abc123', fingerprint: { hash: 'same-hash' } },
      localFingerprint: { hash: 'same-hash' },
    });

    expect(result.ok).toBe(true);
    expect(result.reason).toBeNull();
    expect(result.buildFingerprintHash).toBe('same-hash');
    expect(result.localFingerprintHash).toBe('same-hash');
  });

  it('blocks when the local fingerprint diverges from the latest build (the Aug-11 scenario)', () => {
    const result = evaluateCompatibility({
      platform: 'ios',
      latestBuild: { id: 'build-70', gitCommitHash: '52c956c2', fingerprint: { hash: 'old-native-fingerprint' } },
      localFingerprint: { hash: 'new-native-fingerprint' },
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/Fingerprint mismatch/);
    expect(result.buildFingerprintHash).toBe('old-native-fingerprint');
    expect(result.localFingerprintHash).toBe('new-native-fingerprint');
  });

  it('blocks when there is no finished build to compare against', () => {
    const result = evaluateCompatibility({
      platform: 'android',
      latestBuild: null,
      localFingerprint: { hash: 'whatever' },
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/No finished build found/);
  });

  it('blocks when the latest build has no recorded fingerprint hash', () => {
    const result = evaluateCompatibility({
      platform: 'ios',
      latestBuild: { id: 'build-legacy', fingerprint: null },
      localFingerprint: { hash: 'whatever' },
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/no recorded fingerprint hash/);
  });

  it('blocks when the local fingerprint could not be computed', () => {
    const result = evaluateCompatibility({
      platform: 'ios',
      latestBuild: { id: 'build-1', fingerprint: { hash: 'abc' } },
      localFingerprint: null,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/Could not compute a local fingerprint/);
  });
});

describe('eas-update-guardrails: parseArgs', () => {
  it('defaults to the production channel/environment and both platforms', () => {
    expect(parseArgs([])).toEqual({
      channel: 'production',
      environment: 'production',
      platforms: ['ios', 'android'],
    });
  });

  it('respects explicit overrides', () => {
    expect(parseArgs(['--channel=beta', '--environment=preview', '--platforms=ios'])).toEqual({
      channel: 'beta',
      environment: 'preview',
      platforms: ['ios'],
    });
  });
});
