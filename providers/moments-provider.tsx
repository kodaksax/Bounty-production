/**
 * Moments Queue — provider.
 *
 * The only place in the app that ties the pure engine (lib/moments/engine.ts)
 * to live React/Supabase state. Mounted once, high in the tree (see
 * app/tabs/bounty-app.tsx), so a single global <MomentSheet/> host can
 * surface contextual activation prompts anywhere in the post-auth app, not
 * just immediately after onboarding. Screens never import this file to
 * decide "should I show a prompt" — they either rely on automatic
 * state-derived evaluation, or call momentsService.enqueue() for
 * event-triggered moments (see registry.ts).
 */
import { useRouter } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useAuthContext } from '../hooks/use-auth-context';
import { useAuthProfile } from '../hooks/useAuthProfile';
import { hapticFeedback } from '../lib/haptic-feedback';
import { backfillEventMoments } from '../lib/moments/backfill';
import { evaluateNextMoment } from '../lib/moments/engine';
import { momentsService } from '../lib/moments/momentsService';
import { referralService } from '../lib/moments/referral-service';
import { MOMENT_REGISTRY } from '../lib/moments/registry';
import {
  evaluateReturningUser,
  getSessionCount,
  incrementSessionCount,
  shouldRecordSession,
} from '../lib/moments/sessionTracking';
import type {
  MomentContent,
  MomentContext as MomentCtx,
  MomentDefinition,
  MomentState,
  MomentType,
} from '../lib/moments/types';
import { analyticsService } from '../lib/services/analytics-service';
import { locationService } from '../lib/services/location-service';
import { notificationService } from '../lib/services/notification-service';
import { supabase } from '../lib/supabase';

interface MomentsContextValue {
  activeMoment: MomentDefinition | null;
  activeContent: MomentContent | null;
  accept: () => Promise<void>;
  dismiss: () => void;
  snooze: (hours?: number) => void;
  refresh: () => Promise<void>;
}

const MomentsContext = createContext<MomentsContextValue | null>(null);

/** Resolvers for MomentAction.inline — kept here, not in the registry, since they need live services/hooks. */
const INLINE_HANDLERS: Record<string, () => Promise<boolean>> = {
  request_notifications: async () => {
    const token = await notificationService.requestPermissionsAndRegisterToken();
    return !!token;
  },
  request_location: async () => {
    const perm = await locationService.requestPermission();
    return perm.granted;
  },
  // Delegates to referralService, which is the single feature-detection
  // point for whether a real referral system exists yet (see
  // lib/moments/referral-service.ts). Keeps this moment fully defined and
  // demonstrates the registry supports growth moments without any
  // framework change once a real share flow ships.
  share_invite: async () => referralService.shareInvite(),
};

interface MomentsProviderProps {
  children: React.ReactNode;
  /**
   * Current bottom-nav screen key (see app/tabs/bounty-app.tsx), passed
   * down so registry.ts can gate certain moments to relevant screens (e.g.
   * only offer to post a bounty while on Feed/Activity, not mid-conversation
   * in Messages). Optional so this provider still works if ever mounted
   * outside the tab shell — moments that key off activeScreen simply won't
   * be eligible in that case.
   */
  activeScreen?: string | null;
}

export function MomentsProvider({ children, activeScreen = null }: MomentsProviderProps) {
  const router = useRouter();
  const { session } = useAuthContext();
  const { profile } = useAuthProfile();
  const userId = session?.user?.id ?? null;

  const [states, setStates] = useState<Map<MomentType, MomentState>>(new Map());
  const [notifPermission, setNotifPermission] = useState<'granted' | 'denied' | 'undetermined'>('undetermined');
  const [locPermission, setLocPermission] = useState<'granted' | 'denied' | 'undetermined'>('undetermined');
  const [sessionCount, setSessionCount] = useState(0);
  const [activeMoment, setActiveMoment] = useState<MomentDefinition | null>(null);
  const [activeContent, setActiveContent] = useState<MomentContent | null>(null);
  const shownAtRef = useRef<number | null>(null);
  // Backfill (see lib/moments/backfill.ts) only ever needs to run once per
  // signed-in session — after it resolves, a state row exists either way,
  // so this ref is purely to avoid re-issuing the count queries while that
  // first resolution is still in flight across repeated foreground refreshes.
  const backfillAttemptedForUserRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    if (!userId) {
      setStates(new Map());
      setActiveMoment(null);
      setActiveContent(null);
      return;
    }
    const [fetchedStates, notifStatus, locStatus] = await Promise.all([
      momentsService.fetchStates(userId),
      notificationService.getPermissionStatus(),
      locationService.getPermissionStatus(),
    ]);
    setNotifPermission(notifStatus);
    setLocPermission(locStatus.status);

    // Backfill event-triggered moments for users who onboarded before this
    // wiring existed (new users get these enqueued directly in
    // app/onboarding/done.tsx instead). Gated to once per user per app
    // session; safe to skip entirely once state rows exist (the common case).
    if (backfillAttemptedForUserRef.current !== userId) {
      backfillAttemptedForUserRef.current = userId;
      await backfillEventMoments(userId, profile?.primary_role, fetchedStates).catch(() => {
        // Best-effort — if this fails, it'll be retried next session since
        // no state row will have been created.
        backfillAttemptedForUserRef.current = null;
      });
      // Re-fetch so a moment enqueued/completed by the backfill above is
      // reflected in this refresh cycle instead of waiting for the next one.
      setStates(await momentsService.fetchStates(userId));
    } else {
      setStates(fetchedStates);
    }

    // Session tracking for inactive_user_return + future lifecycle
    // campaigns (see lib/moments/sessionTracking.ts). Read-then-write against
    // profiles.last_session_at, throttled so foreground/background toggles
    // within a session don't spam the DB.
    const lastSessionAt = profile?.last_session_at ?? null;
    const { isReturning, daysSinceLastSession } = evaluateReturningUser(lastSessionAt);
    if (isReturning) {
      momentsService.enqueue(userId, 'inactive_user_return', { daysSinceLastSession });
    }
    if (shouldRecordSession(lastSessionAt)) {
      // Same throttle window doubles as this device's session-boundary
      // definition — see MomentContext.sessionCount doc comment.
      incrementSessionCount(userId).then(setSessionCount);
      supabase
        .from('profiles')
        .update({ last_session_at: new Date().toISOString() })
        .eq('id', userId)
        .then(({ error }) => {
          if (error) console.error('[moments] failed to record last_session_at', error);
        });
    } else {
      getSessionCount(userId).then(setSessionCount);
    }
  }, [userId, profile?.primary_role, profile?.last_session_at]);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  /**
   * Applies a status/metadata change to the in-memory `states` map
   * immediately, in addition to whatever momentsService write is also in
   * flight to Supabase. Without this, `states` only ever changes on the
   * next refresh() (mount or app-foreground) — so a dismiss/snooze/accept
   * during the current session wouldn't be reflected until then. Since the
   * "compute next moment" effect below re-evaluates on every buildContext
   * change (which includes activeScreen, i.e. essentially every bottom-nav
   * tap or onBack call), that stale snapshot would make evaluateNextMoment
   * pick the very moment the user just dismissed right back up on the next
   * button press — this is what synchronizes them so a resolved moment
   * actually stays resolved for the rest of the session.
   */
  const patchState = useCallback(
    (momentType: MomentType, patch: Partial<MomentState> | ((existing: MomentState) => Partial<MomentState>)) => {
      setStates((prev) => {
        const next = new Map(prev);
        const existing: MomentState = next.get(momentType) ?? {
          momentType,
          status: 'pending',
          shownCount: 0,
          firstShownAt: null,
          lastShownAt: null,
          dismissedAt: null,
          completedAt: null,
          snoozedUntil: null,
          metadata: {},
        };
        const resolved = typeof patch === 'function' ? patch(existing) : patch;
        next.set(momentType, { ...existing, ...resolved });
        return next;
      });
    },
    []
  );

  // Re-evaluate whenever the app comes back to the foreground — catches
  // permission grants/denials and profile edits made outside a live session
  // (e.g. in OS Settings) without requiring a full remount.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  const buildContext = useCallback((): MomentCtx | null => {
    if (!userId || !profile) return null;
    return {
      userId,
      accountCreatedAt: profile.created_at ?? null,
      sessionCount,
      activeScreen,
      profile: {
        hasAvatar: !!profile.avatar,
        hasBio: !!profile.about,
        hasLocation: !!profile.location,
        hasSkills: !!(profile.skills && profile.skills.length > 0),
        idVerificationStatus: profile.id_verification_status ?? null,
        stripeConnectChargesEnabled: !!profile.stripe_connect_charges_enabled,
        stripeConnectPayoutsEnabled: !!profile.stripe_connect_payouts_enabled,
        primaryRole: profile.primary_role ?? null,
        balance: profile.balance ?? 0,
      },
      permissions: {
        notifications: notifPermission,
        location: locPermission,
      },
    };
  }, [userId, profile, notifPermission, locPermission, sessionCount, activeScreen]);

  // Auto-complete state-derived moments whose underlying goal was met after
  // they were shown (e.g. user added an avatar via the profile screen, not
  // by tapping "Accept" here) — see MomentDefinition.checkCompleted.
  useEffect(() => {
    const ctx = buildContext();
    if (!ctx || !userId) return;

    (async () => {
      for (const def of MOMENT_REGISTRY) {
        const state = states.get(def.type);
        // Any non-terminal status (shown, snoozed, dismissed, pending) can
        // resolve early if the underlying goal is met through some other
        // path than tapping this moment's own primary button — e.g. the
        // user completes Stripe Connect via the wallet screen's own button
        // after having dismissed/snoozed the prompt. Keeps the persisted
        // status an accurate "completed" rather than stuck on whatever it
        // last was.
        if (state && state.status !== 'completed' && state.status !== 'expired' && def.checkCompleted?.(ctx)) {
          await momentsService.markCompleted(userId, def.type);
          patchState(def.type, { status: 'completed', completedAt: new Date().toISOString() });
          analyticsService.trackEvent('moment_completed', {
            momentType: def.type,
            source: 'auto_detected',
            msSinceShown: state.lastShownAt ? Date.now() - new Date(state.lastShownAt).getTime() : undefined,
          });
          continue;
        }
        // Exhausted its maxShownCount without ever being completed or
        // explicitly dismissed/snoozed — distinguish "we gave up asking"
        // from "the user said no" in backlog/conversion reporting.
        if (
          state?.status === 'shown' &&
          def.maxShownCount != null &&
          state.shownCount >= def.maxShownCount
        ) {
          await momentsService.markExpired(userId, def.type);
          patchState(def.type, { status: 'expired' });
          analyticsService.trackEvent('moment_expired', {
            momentType: def.type,
            shownCount: state.shownCount,
          });
        }
      }
    })();
  }, [states, buildContext, userId, patchState]);

  // Compute the single next-eligible moment. Structurally impossible to
  // surface more than one at a time — evaluateNextMoment always returns
  // at most one definition.
  useEffect(() => {
    const ctx = buildContext();
    if (!ctx || !userId) {
      setActiveMoment(null);
      setActiveContent(null);
      return;
    }

    const next = evaluateNextMoment(ctx, states);
    setActiveMoment((prev) => {
      if (prev?.type === next?.type) return prev;
      if (next) {
        analyticsService.trackEvent('moment_queued', { momentType: next.type, priority: next.priority });
        setActiveContent(next.content(ctx));
      } else {
        setActiveContent(null);
      }
      return next;
    });
  }, [states, buildContext, userId]);

  // Present (mark shown) whenever a new moment becomes active.
  useEffect(() => {
    if (!activeMoment || !userId) return;
    shownAtRef.current = Date.now();
    const now = new Date().toISOString();
    patchState(activeMoment.type, (existing) => ({
      status: 'shown',
      shownCount: existing.shownCount + 1,
      firstShownAt: existing.firstShownAt ?? now,
      lastShownAt: now,
    }));
    momentsService.markShown(userId, activeMoment.type);
    analyticsService.trackEvent('moment_shown', { momentType: activeMoment.type });
  }, [activeMoment, userId, patchState]);

  const dismiss = useCallback(() => {
    if (!activeMoment || !userId) return;
    hapticFeedback.light();
    momentsService.markDismissed(userId, activeMoment.type);
    patchState(activeMoment.type, { status: 'dismissed', dismissedAt: new Date().toISOString() });
    analyticsService.trackEvent('moment_dismissed', {
      momentType: activeMoment.type,
      msVisible: shownAtRef.current ? Date.now() - shownAtRef.current : undefined,
    });
    setActiveMoment(null);
    setActiveContent(null);
  }, [activeMoment, userId, patchState]);

  const snooze = useCallback(
    (hours = 24) => {
      if (!activeMoment || !userId) return;
      const snoozedUntil = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
      momentsService.markSnoozed(userId, activeMoment.type, hours);
      patchState(activeMoment.type, { status: 'snoozed', snoozedUntil });
      analyticsService.trackEvent('moment_snoozed', { momentType: activeMoment.type, hours });
      setActiveMoment(null);
      setActiveContent(null);
    },
    [activeMoment, userId, patchState]
  );

  const accept = useCallback(async () => {
    if (!activeMoment || !userId) return;
    hapticFeedback.light();
    analyticsService.trackEvent('moment_accepted', { momentType: activeMoment.type });

    const def = activeMoment;
    setActiveMoment(null);
    setActiveContent(null);

    if (def.action.type === 'navigate') {
      // Not resolved yet — the user still has to finish the destination
      // flow (e.g. Stripe Connect onboarding). Record that they actively
      // engaged it (distinct from merely having it shown), and snooze it
      // for its normal cooldown window: 'shown' status is deliberately
      // exempt from cooldown (see engine.ts isOnCooldown) so the currently-
      // displayed modal doesn't close itself, but that same exemption means
      // leaving it as 'shown' here would let it pop right back up on the
      // very next button press if the user backs out without finishing —
      // snoozing is what actually suppresses it once it's no longer on
      // screen. The auto-complete effect below still recognizes 'snoozed'
      // (not just 'shown'), so finishing the flow still resolves it early.
      const startedAt = new Date().toISOString();
      const snoozedUntil = new Date(Date.now() + def.cooldownHours * 60 * 60 * 1000).toISOString();
      patchState(def.type, (existing) => ({
        status: 'snoozed',
        snoozedUntil,
        metadata: { ...existing.metadata, startedAt: existing.metadata?.startedAt ?? startedAt },
      }));
      momentsService.markStarted(userId, def.type);
      momentsService.markSnoozed(userId, def.type, def.cooldownHours);
      router.push(def.action.route as any);
      return;
    }

    const handler = INLINE_HANDLERS[def.action.handlerKey];
    const success = handler ? await handler() : false;
    if (success) {
      await momentsService.markCompleted(userId, def.type);
      patchState(def.type, { status: 'completed', completedAt: new Date().toISOString() });
      analyticsService.trackEvent('moment_completed', {
        momentType: def.type,
        source: 'inline_action',
        msSinceShown: shownAtRef.current ? Date.now() - shownAtRef.current : undefined,
      });
    } else {
      analyticsService.trackEvent('moment_skipped', { momentType: def.type, reason: 'inline_action_failed' });
    }
    await refresh();
  }, [activeMoment, userId, router, refresh, patchState]);

  const value = useMemo<MomentsContextValue>(
    () => ({ activeMoment, activeContent, accept, dismiss, snooze, refresh }),
    [activeMoment, activeContent, accept, dismiss, snooze, refresh]
  );

  return <MomentsContext.Provider value={value}>{children}</MomentsContext.Provider>;
}

export function useMoments(): MomentsContextValue {
  const ctx = useContext(MomentsContext);
  if (!ctx) {
    throw new Error('useMoments must be used within a MomentsProvider');
  }
  return ctx;
}
