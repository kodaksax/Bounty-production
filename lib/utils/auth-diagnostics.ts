import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { capture as posthogCapture } from '../posthog';
import { isTimeoutError } from './auth-errors';
import { logger } from './error-logger';

export type AuthLifecycleStatus =
  | 'started'
  | 'success'
  | 'failure'
  | 'timeout'
  | 'cancelled'
  | 'retry';

export interface AuthNetworkSnapshot {
  isConnected: boolean | null;
  isInternetReachable: boolean | null;
  type: string;
}

export interface AuthLifecycleEvent {
  correlationId: string;
  stage: string;
  status: AuthLifecycleStatus;
  startedAt: string;
  finishedAt?: string;
  elapsedMs?: number;
  timeoutMs?: number;
  retry?: number;
  cancelled?: boolean;
  outcome?: string;
  errorMessage?: string;
  errorCode?: string | number;
  network?: AuthNetworkSnapshot;
  metadata?: Record<string, unknown>;
}

interface RuntimeMetadata {
  platform: string;
  appVersion: string;
  buildNumber: string;
  environment: string;
  supabaseRegion: string;
}

function getRuntimeMetadata(): RuntimeMetadata {
  const appVersion = Constants.nativeAppVersion || Constants.expoConfig?.version || 'unknown';
  const buildNumber =
    Constants.nativeBuildVersion ||
    String(
      (Constants.expoConfig as any)?.ios?.buildNumber ||
        (Constants.expoConfig as any)?.android?.versionCode ||
        'unknown'
    );
  const environment =
    process.env.EXPO_PUBLIC_ENVIRONMENT ||
    String((Constants.expoConfig?.extra as any)?.APP_ENV || 'unknown');
  const supabaseRegion = process.env.EXPO_PUBLIC_SUPABASE_REGION || 'unknown';

  return {
    platform: Platform.OS,
    appVersion,
    buildNumber,
    environment,
    supabaseRegion,
  };
}

function mapLifecycleStatusToEventName(status: AuthLifecycleStatus): string {
  switch (status) {
    case 'started':
      return 'AUTH_STAGE_STARTED';
    case 'success':
      return 'AUTH_STAGE_COMPLETED';
    case 'timeout':
      return 'AUTH_STAGE_TIMEOUT';
    case 'failure':
      return 'AUTH_STAGE_FAILED';
    case 'cancelled':
      return 'AUTH_STAGE_CANCELLED';
    case 'retry':
      return 'AUTH_STAGE_RETRY';
    default:
      return 'AUTH_STAGE_EVENT';
  }
}

function emitAuthTelemetry(event: AuthLifecycleEvent): void {
  try {
    const runtime = getRuntimeMetadata();
    const eventName = mapLifecycleStatusToEventName(event.status);

    const payload: Record<string, unknown> = {
      correlation_id: event.correlationId,
      user_id:
        (event.metadata?.userId as string | undefined) ||
        (event.metadata?.authUserId as string | undefined) ||
        null,
      auth_stage: event.stage,
      auth_status: event.status,
      elapsed_ms: event.elapsedMs ?? null,
      started_at: event.startedAt,
      finished_at: event.finishedAt ?? null,
      timeout_ms: event.timeoutMs ?? null,
      cancelled: event.cancelled ?? false,
      retry: event.retry ?? 0,
      network_type: event.network?.type ?? 'unknown',
      network_connected: event.network?.isConnected ?? null,
      network_reachable: event.network?.isInternetReachable ?? null,
      app_platform: runtime.platform,
      app_version: runtime.appVersion,
      app_build_number: runtime.buildNumber,
      app_environment: runtime.environment,
      supabase_region: runtime.supabaseRegion,
      outcome: event.outcome ?? null,
      error_code: event.errorCode ?? null,
      error_message: event.errorMessage ?? null,
      ...event.metadata,
    };

    posthogCapture(eventName, payload);
  } catch {
    // Telemetry failures must never break auth flow.
  }
}

export async function getNetworkSnapshot(): Promise<AuthNetworkSnapshot> {
  try {
    // Lazy require keeps startup resilient in environments where NetInfo is unavailable.
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const netInfoModule = require('@react-native-community/netinfo');
    const netInfo = netInfoModule?.default ?? netInfoModule;
    if (!netInfo || typeof netInfo.fetch !== 'function') {
      return { isConnected: null, isInternetReachable: null, type: 'unknown' };
    }
    const state = await netInfo.fetch();
    return {
      isConnected: state?.isConnected ?? null,
      isInternetReachable: state?.isInternetReachable ?? null,
      type: state?.type ?? 'unknown',
    };
  } catch {
    return { isConnected: null, isInternetReachable: null, type: 'unknown' };
  }
}

export function logAuthLifecycleEvent(event: AuthLifecycleEvent): void {
  const payload = {
    ...event,
    finishedAt: event.finishedAt ?? new Date().toISOString(),
  };

  const message = '[auth-lifecycle]';
  emitAuthTelemetry(payload);
  if (event.status === 'failure' || event.status === 'timeout') {
    logger.error(message, payload);
    return;
  }

  if (event.status === 'cancelled') {
    logger.warning(message, payload);
    return;
  }

  logger.info(message, payload);
}

interface AuthLoginSuccessEvent {
  correlationId: string;
  userId?: string | null;
  totalDurationMs: number;
  method: 'email' | 'google' | 'apple' | 'unknown';
  destination: string;
  metadata?: Record<string, unknown>;
}

export async function emitAuthLoginSuccess(event: AuthLoginSuccessEvent): Promise<void> {
  try {
    const runtime = getRuntimeMetadata();
    const network = await getNetworkSnapshot();

    posthogCapture('AUTH_LOGIN_SUCCESS', {
      correlation_id: event.correlationId,
      user_id: event.userId ?? null,
      auth_stage: 'login-end-to-end',
      auth_method: event.method,
      destination: event.destination,
      elapsed_ms: event.totalDurationMs,
      app_platform: runtime.platform,
      app_version: runtime.appVersion,
      app_build_number: runtime.buildNumber,
      app_environment: runtime.environment,
      supabase_region: runtime.supabaseRegion,
      network_type: network.type,
      network_connected: network.isConnected,
      network_reachable: network.isInternetReachable,
      ...event.metadata,
    });
  } catch {
    // Best effort only.
  }
}

interface RunAuthStageOptions<T> {
  correlationId: string;
  stage: string;
  timeoutMs: number;
  run: () => PromiseLike<T>;
  retry?: number;
  metadata?: Record<string, unknown>;
}

export async function runAuthStageWithTimeout<T>(options: RunAuthStageOptions<T>): Promise<T> {
  const { correlationId, stage, timeoutMs, run, retry = 0, metadata } = options;
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const networkAtStart = await getNetworkSnapshot();

  logAuthLifecycleEvent({
    correlationId,
    stage,
    status: 'started',
    startedAt,
    timeoutMs,
    retry,
    network: networkAtStart,
    metadata,
  });

  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    const result = await Promise.race<T>([
      run(),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          const timeoutError = new Error(
            `Authentication step "${stage}" timed out after ${timeoutMs}ms`
          ) as Error & { code?: string; stage?: string; status?: number };
          timeoutError.code = 'AUTH_STAGE_TIMEOUT';
          timeoutError.stage = stage;
          timeoutError.status = 408;
          reject(timeoutError);
        }, timeoutMs);
      }),
    ]);

    const finishedAtMs = Date.now();
    logAuthLifecycleEvent({
      correlationId,
      stage,
      status: 'success',
      startedAt,
      finishedAt: new Date(finishedAtMs).toISOString(),
      elapsedMs: finishedAtMs - startedAtMs,
      timeoutMs,
      retry,
      network: await getNetworkSnapshot(),
      metadata,
      outcome: 'resolved',
    });

    return result;
  } catch (error: any) {
    const finishedAtMs = Date.now();
    const isTimeout = isTimeoutError(error) || error?.code === 'AUTH_STAGE_TIMEOUT';
    const cancelled = error?.name === 'AbortError' || error?.code === 'ERR_CANCELED';

    logAuthLifecycleEvent({
      correlationId,
      stage,
      status: isTimeout ? 'timeout' : cancelled ? 'cancelled' : 'failure',
      startedAt,
      finishedAt: new Date(finishedAtMs).toISOString(),
      elapsedMs: finishedAtMs - startedAtMs,
      timeoutMs,
      retry,
      cancelled,
      network: await getNetworkSnapshot(),
      errorMessage: error?.message || String(error),
      errorCode: error?.code || error?.status,
      metadata,
      outcome: isTimeout ? 'timed_out' : cancelled ? 'cancelled' : 'rejected',
    });

    throw error;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}
