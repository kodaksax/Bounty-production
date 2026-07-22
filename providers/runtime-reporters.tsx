/**
 * RuntimeReporters
 *
 * A headless bridge component that reads each provider's public state and
 * reports it to the central {@link AppRuntimeProvider}. It must be rendered
 * INSIDE all of the individual providers (Network, Auth, Stripe, Wallet,
 * Notifications, WebSocket) but underneath the AppRuntimeProvider, so it can
 * consume every context and forward readiness to a single source of truth.
 *
 * Keeping this logic in one headless component (rather than scattering
 * `report(...)` calls across each provider) keeps the individual providers
 * decoupled from runtime orchestration and makes the readiness policy easy to
 * reason about in one place.
 */

import { useEffect } from 'react';

import { useAuthContext } from '../hooks/use-auth-context';
import { useNotifications } from '../lib/context/notification-context';
import { useStripe } from '../lib/stripe-context';
import { isSupabaseConfigured } from '../lib/supabase';
import { useWallet } from '../lib/wallet-context';
import { useAppRuntime } from './app-runtime-provider';
import { useOptionalNetworkContext } from './network-provider';
import { useWebSocketContext } from './websocket-provider';

export function RuntimeReporters(): null {
  const runtime = useAppRuntime();
  const network = useOptionalNetworkContext();
  const auth = useAuthContext();
  const stripe = useStripe();
  const wallet = useWallet();
  const notifications = useNotifications();
  const ws = useWebSocketContext();

  const { report } = runtime;

  // --- Supabase: configuration is known synchronously and does not change. ---
  useEffect(() => {
    if (isSupabaseConfigured) {
      report('supabase', 'ready');
    } else {
      report('supabase', 'error', { error: 'Supabase environment not configured' });
    }
  }, [report]);

  // --- Remote configuration: no dynamic remote config today; trivially ready.
  useEffect(() => {
    report('remoteConfig', 'ready', { source: 'none' });
  }, [report]);

  // --- Network (required) ---
  useEffect(() => {
    if (!network) {
      report('network', 'initializing');
      return;
    }
    const reachable = network.isInternetReachable !== false;
    const online = network.isConnected && reachable;
    report('network', online ? 'ready' : 'offline');
  }, [report, network, network?.isConnected, network?.isInternetReachable]);

  // --- Authentication (required) ---
  useEffect(() => {
    if (auth.isLoading) {
      report('auth', 'initializing');
    } else if (auth.isAuthStale) {
      report('auth', 'degraded', { reason: 'stale-session' });
    } else {
      report('auth', 'ready', { authenticated: auth.isLoggedIn });
    }
  }, [report, auth.isLoading, auth.isAuthStale, auth.isLoggedIn]);

  // --- Stripe (optional) ---
  useEffect(() => {
    if (stripe.error) {
      report('stripe', 'degraded', { error: stripe.error });
    } else if (stripe.isInitialized) {
      report('stripe', 'ready');
    } else {
      report('stripe', 'initializing');
    }
  }, [report, stripe.error, stripe.isInitialized]);

  // --- Wallet (optional) ---
  useEffect(() => {
    if (!wallet.secureStoreAvailable) {
      report('wallet', 'degraded', { reason: 'secure-store-unavailable' });
    } else if (wallet.isLoading) {
      report('wallet', 'initializing');
    } else {
      report('wallet', 'ready');
    }
  }, [report, wallet.isLoading, wallet.secureStoreAvailable]);

  // --- Notifications (optional) ---
  useEffect(() => {
    report('notifications', notifications.loading ? 'initializing' : 'ready');
  }, [report, notifications.loading]);

  // --- Realtime / WebSocket (optional) ---
  useEffect(() => {
    // Realtime only connects once the user is authenticated. Before login a
    // `disconnected` quality is expected and must NOT mark the service in error.
    if (!auth.isLoggedIn) {
      report('realtime', 'initializing', { reason: 'awaiting-auth' });
      return;
    }
    if (ws.connectionQuality === 'disconnected') {
      report('realtime', 'initializing', { quality: ws.connectionQuality });
    } else {
      report('realtime', 'ready', { quality: ws.connectionQuality });
    }
  }, [report, auth.isLoggedIn, ws.connectionQuality]);

  return null;
}
