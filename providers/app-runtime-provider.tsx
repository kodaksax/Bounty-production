/**
 * AppRuntimeProvider
 *
 * A single, centralized source of truth for application runtime readiness.
 *
 * Individual providers (Network, Auth, Stripe, Wallet, Notifications,
 * Realtime/WebSocket, Supabase, remote config) each report their own status to
 * this runtime. The provider aggregates those signals into one unified
 * `RuntimePhase` so screens and boot logic no longer need to stitch together
 * fragmented loading flags.
 *
 * Aggregation rules (see `computeRuntimePhase`):
 * - The app is `ready` only once every REQUIRED service reaches `ready`.
 * - If a required service is offline (network) the runtime is `offline`.
 * - If a required service errors, the runtime is `error`.
 * - If required services are ready but an OPTIONAL service errors/degrades, the
 *   runtime is `degraded` (usable, but not fully healthy).
 * - If the app was previously `ready` and a required service drops, the runtime
 *   is `recovering` (as opposed to a first-boot `initializing`).
 *
 * This module is mobile-only and imports no web-only dependencies.
 */

import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';

import { startupDiagnostics } from '../lib/utils/startup-diagnostics';

export type ServiceStatus = 'idle' | 'initializing' | 'ready' | 'degraded' | 'offline' | 'error';

export type RuntimePhase =
  | 'initializing'
  | 'ready'
  | 'degraded'
  | 'recovering'
  | 'offline'
  | 'error';

export type RuntimeServiceName =
  | 'network'
  | 'auth'
  | 'supabase'
  | 'stripe'
  | 'wallet'
  | 'notifications'
  | 'realtime'
  | 'remoteConfig';

/** Services that must reach `ready` before the app is considered `ready`. */
const REQUIRED_SERVICES: readonly RuntimeServiceName[] = ['network', 'auth', 'supabase'];

/** Services that can be unavailable without blocking overall readiness. */
const OPTIONAL_SERVICES: readonly RuntimeServiceName[] = [
  'stripe',
  'wallet',
  'notifications',
  'realtime',
  'remoteConfig',
];

export interface ServiceState {
  status: ServiceStatus;
  required: boolean;
  error?: string;
  /** ms since app start when this service last changed status. */
  updatedAt: number;
}

export interface RuntimeSnapshot {
  phase: RuntimePhase;
  services: Record<RuntimeServiceName, ServiceState>;
  /** True once every required service has reached `ready` at least once. */
  isReady: boolean;
  /** ms elapsed from app start to the first `ready` transition (or null). */
  timeToReadyMs: number | null;
}

export interface AppRuntimeContextValue extends RuntimeSnapshot {
  /**
   * Report a service's current status. Safe to call from effects; only records
   * (and re-renders) when the status or error actually changes.
   */
  report: (
    service: RuntimeServiceName,
    status: ServiceStatus,
    meta?: { error?: string } & Record<string, unknown>
  ) => void;
}

function createInitialServices(): Record<RuntimeServiceName, ServiceState> {
  const all: RuntimeServiceName[] = [...REQUIRED_SERVICES, ...OPTIONAL_SERVICES];
  const services = {} as Record<RuntimeServiceName, ServiceState>;
  for (const name of all) {
    services[name] = {
      status: 'idle',
      required: REQUIRED_SERVICES.includes(name),
      updatedAt: 0,
    };
  }
  return services;
}

/**
 * Pure aggregation of per-service statuses into a single runtime phase.
 * Exported for unit testing.
 */
export function computeRuntimePhase(
  services: Record<RuntimeServiceName, ServiceState>,
  wasReady: boolean
): RuntimePhase {
  const entries = Object.values(services);
  const required = entries.filter(s => s.required);
  const optional = entries.filter(s => !s.required);

  const network = services.network;
  const requiredError = required.some(s => s.status === 'error');
  const requiredReady = required.every(s => s.status === 'ready');

  // Offline takes precedence — nothing else can be trusted without network.
  if (network.status === 'offline') {
    return 'offline';
  }

  if (requiredError) {
    return 'error';
  }

  if (requiredReady) {
    // Required stack is healthy. Optional services only downgrade to degraded
    // when they are explicitly in error/degraded/offline — an optional service
    // that is still `initializing` does not block a healthy app.
    const optionalUnhealthy = optional.some(
      s => s.status === 'error' || s.status === 'degraded' || s.status === 'offline'
    );
    return optionalUnhealthy ? 'degraded' : 'ready';
  }

  // Required services are not all ready yet.
  return wasReady ? 'recovering' : 'initializing';
}

const AppRuntimeContext = createContext<AppRuntimeContextValue | undefined>(undefined);

export function AppRuntimeProvider({ children }: { children: React.ReactNode }) {
  const [services, setServices] =
    useState<Record<RuntimeServiceName, ServiceState>>(createInitialServices);
  const wasReadyRef = useRef(false);
  const timeToReadyRef = useRef<number | null>(null);

  const report = useCallback<AppRuntimeContextValue['report']>((service, status, meta) => {
    setServices(prev => {
      const current = prev[service];
      if (!current) {
        return prev;
      }
      const nextError = meta?.error;
      if (current.status === status && current.error === nextError) {
        return prev; // no-op: avoids redundant re-renders / diagnostics spam
      }

      // Emit structured diagnostics for the transition.
      switch (status) {
        case 'initializing':
          startupDiagnostics.begin(service, meta);
          break;
        case 'ready':
          startupDiagnostics.success(service, meta);
          break;
        case 'degraded':
          startupDiagnostics.degraded(service, meta);
          break;
        case 'offline':
          startupDiagnostics.degraded(service, { reason: 'offline', ...meta });
          break;
        case 'error':
          startupDiagnostics.failure(service, nextError ?? 'unknown error', meta);
          break;
        default:
          break;
      }

      return {
        ...prev,
        [service]: {
          ...current,
          status,
          error: nextError,
          updatedAt: startupDiagnostics.elapsedMs(),
        },
      };
    });
  }, []);

  const phase = useMemo(() => computeRuntimePhase(services, wasReadyRef.current), [services]);

  const requiredReady = useMemo(
    () => REQUIRED_SERVICES.every(name => services[name].status === 'ready'),
    [services]
  );

  // Track the first time the app becomes fully ready for observability.
  useEffect(() => {
    if (requiredReady && !wasReadyRef.current) {
      wasReadyRef.current = true;
      timeToReadyRef.current = startupDiagnostics.elapsedMs();
      startupDiagnostics.readiness('ready', { timeToReadyMs: timeToReadyRef.current });
    }
  }, [requiredReady]);

  // Emit a runtime readiness breadcrumb whenever the aggregate phase changes.
  const prevPhaseRef = useRef<RuntimePhase | null>(null);
  useEffect(() => {
    if (prevPhaseRef.current !== phase) {
      prevPhaseRef.current = phase;
      startupDiagnostics.readiness(phase);
    }
  }, [phase]);

  const value = useMemo<AppRuntimeContextValue>(
    () => ({
      phase,
      services,
      isReady: wasReadyRef.current,
      timeToReadyMs: timeToReadyRef.current,
      report,
    }),
    [phase, services, report]
  );

  return <AppRuntimeContext.Provider value={value}>{children}</AppRuntimeContext.Provider>;
}

/** Access the runtime readiness state. Throws if used outside the provider. */
export function useAppRuntime(): AppRuntimeContextValue {
  const ctx = useContext(AppRuntimeContext);
  if (!ctx) {
    throw new Error('useAppRuntime must be used within an AppRuntimeProvider');
  }
  return ctx;
}

/** Non-throwing variant for components that may render outside the provider. */
export function useOptionalAppRuntime(): AppRuntimeContextValue | undefined {
  return useContext(AppRuntimeContext);
}
