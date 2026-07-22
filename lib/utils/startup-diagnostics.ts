/**
 * Startup Diagnostics
 *
 * Lightweight, dependency-free structured diagnostics for the application
 * startup/readiness lifecycle. Every critical service reports its lifecycle
 * transitions here so a failure can be traced from root cause through recovery
 * without manual debugging.
 *
 * Design goals:
 * - Zero heavy imports at module-eval time (safe to import from the runtime
 *   provider and from services during early boot).
 * - Best-effort forwarding to Sentry breadcrumbs when available, but never
 *   requires it.
 * - Keeps an in-memory timeline that can be dumped for support/debugging.
 */

export type DiagnosticLevel = 'info' | 'warn' | 'error';

export interface DiagnosticEvent {
  /** Logical service or step name (e.g. 'network', 'auth', 'runtime'). */
  service: string;
  /** Short machine-readable phase (e.g. 'begin', 'ready', 'error', 'retry'). */
  phase: string;
  level: DiagnosticLevel;
  /** ms since app process start (approx) when the event was recorded. */
  atMs: number;
  /** Duration since this service's most recent `begin`, when applicable. */
  durationMs?: number;
  /** Optional structured metadata (never contains secrets). */
  meta?: Record<string, unknown>;
}

const PROCESS_START = Date.now();
const MAX_TIMELINE = 200;

function now(): number {
  return Date.now() - PROCESS_START;
}

function isDev(): boolean {
  return typeof __DEV__ !== 'undefined' && __DEV__;
}

class StartupDiagnostics {
  private timeline: DiagnosticEvent[] = [];
  private beganAt = new Map<string, number>();
  private listeners = new Set<(event: DiagnosticEvent) => void>();

  /** Subscribe to diagnostic events. Returns an unsubscribe function. */
  subscribe(listener: (event: DiagnosticEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private record(event: DiagnosticEvent): void {
    this.timeline.push(event);
    if (this.timeline.length > MAX_TIMELINE) {
      this.timeline.shift();
    }

    // Best-effort console output.
    const label = `[startup:${event.service}] ${event.phase}`;
    const payload =
      event.durationMs !== undefined ? { ...event.meta, durationMs: event.durationMs } : event.meta;
    if (isDev()) {
      if (event.level === 'error') {
        // eslint-disable-next-line no-console
        console.error(label, payload ?? '');
      } else if (event.level === 'warn') {
        // eslint-disable-next-line no-console
        console.warn(label, payload ?? '');
      } else {
        // eslint-disable-next-line no-console
        console.log(label, payload ?? '');
      }
    }

    // Best-effort Sentry breadcrumb (never required).
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
      const Sentry = require('@sentry/react-native');
      if (Sentry && typeof Sentry.addBreadcrumb === 'function') {
        Sentry.addBreadcrumb({
          category: 'startup',
          message: label,
          level: event.level === 'warn' ? 'warning' : event.level,
          data: payload,
        });
      }
    } catch {
      // ignore — Sentry not present in this runtime
    }

    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // never let a diagnostics listener break startup
      }
    }
  }

  /** Mark the beginning of a service initialization step. */
  begin(service: string, meta?: Record<string, unknown>): void {
    this.beganAt.set(service, Date.now());
    this.record({ service, phase: 'begin', level: 'info', atMs: now(), meta });
  }

  /** Mark a service as successfully ready, with duration since `begin`. */
  success(service: string, meta?: Record<string, unknown>): void {
    const started = this.beganAt.get(service);
    const durationMs = started !== undefined ? Date.now() - started : undefined;
    this.record({ service, phase: 'ready', level: 'info', atMs: now(), durationMs, meta });
  }

  /** Mark a service as degraded (usable but not fully healthy). */
  degraded(service: string, meta?: Record<string, unknown>): void {
    this.record({ service, phase: 'degraded', level: 'warn', atMs: now(), meta });
  }

  /** Record a retry attempt for a service. */
  retry(service: string, attempt: number, meta?: Record<string, unknown>): void {
    this.record({
      service,
      phase: 'retry',
      level: 'warn',
      atMs: now(),
      meta: { attempt, ...meta },
    });
  }

  /** Record a recovery action taken for a service. */
  recover(service: string, meta?: Record<string, unknown>): void {
    this.record({ service, phase: 'recover', level: 'info', atMs: now(), meta });
  }

  /** Mark a service as failed. */
  failure(service: string, error: unknown, meta?: Record<string, unknown>): void {
    const started = this.beganAt.get(service);
    const durationMs = started !== undefined ? Date.now() - started : undefined;
    const message = error instanceof Error ? error.message : String(error);
    this.record({
      service,
      phase: 'error',
      level: 'error',
      atMs: now(),
      durationMs,
      meta: { error: message, ...meta },
    });
  }

  /** Record the overall runtime readiness transition. */
  readiness(state: string, meta?: Record<string, unknown>): void {
    this.record({ service: 'runtime', phase: state, level: 'info', atMs: now(), meta });
  }

  /** Return a copy of the recorded timeline for support/debugging. */
  getTimeline(): DiagnosticEvent[] {
    return [...this.timeline];
  }

  /** Milliseconds elapsed since the process (module eval) started. */
  elapsedMs(): number {
    return now();
  }

  /** Clear the timeline (primarily for tests). */
  reset(): void {
    this.timeline = [];
    this.beganAt.clear();
  }
}

export const startupDiagnostics = new StartupDiagnostics();
