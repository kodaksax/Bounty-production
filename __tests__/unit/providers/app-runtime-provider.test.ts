import { startupDiagnostics } from '../../../lib/utils/startup-diagnostics';
import {
    computeRuntimePhase,
    type RuntimeServiceName,
    type ServiceState,
    type ServiceStatus,
} from '../../../providers/app-runtime-provider';

/**
 * These tests exercise the pure runtime-phase aggregation logic and the
 * structured startup diagnostics. Together they cover the "startup chaos"
 * scenarios that are deterministic at the state-machine level: offline boot,
 * auth delay, required-service error, optional-service degradation, and the
 * ready -> drop -> recovering transition.
 */

const ALL_SERVICES: RuntimeServiceName[] = [
  'network',
  'auth',
  'supabase',
  'stripe',
  'wallet',
  'notifications',
  'realtime',
  'remoteConfig',
];

const REQUIRED: RuntimeServiceName[] = ['network', 'auth', 'supabase'];

function makeServices(
  overrides: Partial<Record<RuntimeServiceName, ServiceStatus>> = {}
): Record<RuntimeServiceName, ServiceState> {
  const services = {} as Record<RuntimeServiceName, ServiceState>;
  for (const name of ALL_SERVICES) {
    const status = overrides[name] ?? 'ready';
    services[name] = {
      status,
      required: REQUIRED.includes(name),
      updatedAt: 0,
    };
  }
  return services;
}

describe('computeRuntimePhase', () => {
  test('all required + optional ready => ready', () => {
    expect(computeRuntimePhase(makeServices(), false)).toBe('ready');
  });

  test('network offline dominates everything => offline', () => {
    const services = makeServices({ network: 'offline', auth: 'error' });
    expect(computeRuntimePhase(services, false)).toBe('offline');
  });

  test('required service error (not network) => error', () => {
    expect(computeRuntimePhase(makeServices({ supabase: 'error' }), false)).toBe('error');
  });

  test('auth still initializing on first boot => initializing', () => {
    expect(computeRuntimePhase(makeServices({ auth: 'initializing' }), false)).toBe('initializing');
  });

  test('required not ready after previously ready => recovering', () => {
    expect(computeRuntimePhase(makeServices({ auth: 'initializing' }), true)).toBe('recovering');
  });

  test('optional service still initializing does NOT block ready', () => {
    const services = makeServices({ realtime: 'initializing', notifications: 'initializing' });
    expect(computeRuntimePhase(services, false)).toBe('ready');
  });

  test('optional service degraded => degraded (app still usable)', () => {
    expect(computeRuntimePhase(makeServices({ stripe: 'degraded' }), false)).toBe('degraded');
  });

  test('optional service error => degraded, not error', () => {
    expect(computeRuntimePhase(makeServices({ wallet: 'error' }), false)).toBe('degraded');
  });

  test('offline boot then online recovery transitions offline -> ready', () => {
    const offline = makeServices({ network: 'offline', auth: 'initializing' });
    expect(computeRuntimePhase(offline, false)).toBe('offline');
    const recovered = makeServices();
    expect(computeRuntimePhase(recovered, false)).toBe('ready');
  });
});

describe('startupDiagnostics', () => {
  beforeEach(() => {
    startupDiagnostics.reset();
  });

  test('records begin -> ready with a duration', () => {
    startupDiagnostics.begin('auth');
    startupDiagnostics.success('auth');
    const timeline = startupDiagnostics.getTimeline();
    const ready = timeline.find(e => e.service === 'auth' && e.phase === 'ready');
    expect(ready).toBeDefined();
    expect(ready?.durationMs).toBeGreaterThanOrEqual(0);
  });

  test('records failures with error message and level', () => {
    startupDiagnostics.begin('stripe');
    startupDiagnostics.failure('stripe', new Error('init timeout'));
    const evt = startupDiagnostics
      .getTimeline()
      .find(e => e.service === 'stripe' && e.phase === 'error');
    expect(evt?.level).toBe('error');
    expect(evt?.meta?.error).toBe('init timeout');
  });

  test('records retry attempts', () => {
    startupDiagnostics.retry('realtime', 3);
    const evt = startupDiagnostics
      .getTimeline()
      .find(e => e.service === 'realtime' && e.phase === 'retry');
    expect(evt?.meta?.attempt).toBe(3);
  });

  test('subscribers receive events and can unsubscribe', () => {
    const seen: string[] = [];
    const unsubscribe = startupDiagnostics.subscribe(e => seen.push(e.phase));
    startupDiagnostics.readiness('ready');
    unsubscribe();
    startupDiagnostics.readiness('degraded');
    expect(seen).toContain('ready');
    expect(seen).not.toContain('degraded');
  });

  test('timeline is capped and never throws for listener errors', () => {
    const unsubscribe = startupDiagnostics.subscribe(() => {
      throw new Error('bad listener');
    });
    expect(() => startupDiagnostics.readiness('ready')).not.toThrow();
    unsubscribe();
  });
});
