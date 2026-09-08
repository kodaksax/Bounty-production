// app/bounty/[id]/index.tsx — the deep-link entry point for a single bounty.
//
// Every external route into a bounty (push notification, shared link, search
// result, admin console) lands here. Its only job is to decide which of the
// three real surfaces the viewer belongs on and hand off:
//
//   poster  → /postings/[bountyId]        (their command center)
//   hunter  → /in-progress/[bountyId]/hunter (their hub — including for a
//                                             rejected or withdrawn application)
//   public  → /bounty/[id]/public          (read-only, with an Apply action)
//
// Previously anyone with no relationship to the bounty was sent to the poster's
// dashboard, which answered with an "Access Denied" alert and `router.back()`.
// From a notification or a shared link there was nothing behind it to go back
// to. The routing decision now lives in getBountyDetailSurface, where it is
// unit-tested, and the failure states below are real screens rather than an
// alert.
import { MaterialIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NotFoundScreen } from '../../../components/not-found-screen';
import { useAuthContext } from '../../../hooks/use-auth-context';
import { ROUTES } from '../../../lib/routes';
import { analyticsService } from '../../../lib/services/analytics-service';
import { bountyRequestService } from '../../../lib/services/bounty-request-service';
import { bountyService } from '../../../lib/services/bounty-service';
import { useAppThemeContext } from '../../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../../lib/themes/types';
import { getBountyDetailSurface } from '../../../lib/utils/bounty-lifecycle';

const FEED_ROUTE = `${ROUTES.TABS.BOUNTY_APP}?screen=bounty`;

export default function BountyDetailRouter() {
  const { id, source } = useLocalSearchParams<{ id?: string; source?: string }>();
  const router = useRouter();
  // The session restores after the first render on a cold start. Routing
  // before it resolves would send a poster (or an accepted hunter) to the
  // public read-only view, which is exactly the mis-route this screen exists
  // to prevent.
  const { session, isLoading: isAuthLoading } = useAuthContext();
  const currentUserId = session?.user?.id ?? null;
  const { theme } = useAppThemeContext();
  const s = useMemo(() => makeStyles(theme), [theme]);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const routeBountyId = useMemo(() => {
    const raw = Array.isArray(id) ? id[0] : id;
    return raw && String(raw).trim().length > 0 ? String(raw) : null;
  }, [id]);

  // Tracks the most recently requested bounty id so a slower, stale response
  // for a previous id (fast back-and-forth between two bounty links) can't
  // route on the wrong bounty after a newer request has already resolved.
  const latestRequestedIdRef = useRef<string | null>(null);

  const routeToSurface = useCallback(
    async (bountyId: string) => {
      latestRequestedIdRef.current = bountyId;
      const isStale = () => latestRequestedIdRef.current !== bountyId;

      try {
        setIsLoading(true);
        setError(null);
        setNotFound(false);

        const bounty = await bountyService.getById(bountyId);
        if (isStale()) return;
        if (!bounty) {
          setNotFound(true);
          return;
        }

        const isPoster =
          !!currentUserId &&
          (String(bounty.user_id) === String(currentUserId) ||
            String(bounty.poster_id) === String(currentUserId));

        const secondsSincePosted = bounty.created_at
          ? Math.max(0, Math.round((Date.now() - new Date(bounty.created_at).getTime()) / 1000))
          : undefined;
        analyticsService.trackEvent('bounty_viewed', {
          bounty_id: String(bounty.id),
          is_own_bounty: isPoster,
          amount: typeof bounty.amount === 'number' ? bounty.amount : undefined,
          is_for_honor: Boolean(bounty.is_for_honor),
          category: bounty.category,
          distance_miles: bounty.distance_miles ?? undefined,
          seconds_since_posted: secondsSincePosted,
          source: typeof source === 'string' ? source : undefined,
          surface: 'role_route',
        });

        // Only a signed-in non-poster can have an application to look up.
        let requestStatus: string | null = null;
        if (!isPoster && currentUserId) {
          try {
            const requests = await bountyRequestService.getAll({
              bountyId,
              userId: currentUserId,
            });
            if (isStale()) return;
            requestStatus = requests.length > 0 ? (requests[0].status ?? 'pending') : null;
          } catch {
            // A failed lookup must not strand an accepted hunter on the public
            // view: fall through to the accepted_by check below.
          }
        }

        const surface = getBountyDetailSurface({
          isPoster,
          requestStatus,
          isAcceptedHunter:
            !!currentUserId && String(bounty.accepted_by ?? '') === String(currentUserId),
        });

        if (isStale()) return;

        if (surface === 'poster') {
          router.replace({ pathname: '/postings/[bountyId]', params: { bountyId } });
        } else if (surface === 'hunter') {
          router.replace({ pathname: '/in-progress/[bountyId]/hunter', params: { bountyId } });
        } else {
          router.replace({ pathname: '/bounty/[id]/public', params: { id: bountyId } });
        }
      } catch (err) {
        if (isStale()) return;
        console.error('Error routing to bounty detail:', err);
        setError('load_failed');
      } finally {
        if (latestRequestedIdRef.current === bountyId) setIsLoading(false);
      }
    },
    [currentUserId, router, source]
  );

  useEffect(() => {
    if (isAuthLoading) return;
    if (!routeBountyId) {
      setNotFound(true);
      setIsLoading(false);
      return;
    }
    routeToSurface(routeBountyId);
  }, [isAuthLoading, routeBountyId, routeToSurface]);

  const goToFeed = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace(FEED_ROUTE as never);
  }, [router]);

  if (notFound) {
    return (
      <NotFoundScreen
        title="This bounty isn't available"
        message="It was removed, completed, or the link points somewhere that no longer exists."
        icon="search-off"
        actionText="Browse bounties"
        onAction={() => router.replace(FEED_ROUTE as never)}
      />
    );
  }

  if (error) {
    return (
      <SafeAreaView style={s.centered}>
        <MaterialIcons name="cloud-off" size={48} color={theme.textSecondary} />
        <Text style={s.title}>{"Couldn't open this bounty"}</Text>
        <Text style={s.body}>
          {"You're offline or the connection dropped. Nothing about the bounty has changed."}
        </Text>
        <TouchableOpacity
          style={s.primaryBtn}
          onPress={() => routeBountyId && routeToSurface(routeBountyId)}
          accessibilityRole="button"
          accessibilityLabel="Try again"
        >
          <Text style={s.primaryBtnText}>Try again</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.textBtn} onPress={goToFeed} accessibilityRole="button">
          <Text style={s.textBtnText}>Go back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.centered}>
      <ActivityIndicator size="large" color={theme.primary} />
      <Text style={s.body}>{isLoading ? 'Loading bounty…' : 'Opening bounty…'}</Text>
    </SafeAreaView>
  );
}

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    centered: {
      flex: 1,
      backgroundColor: t.background,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12,
      padding: 32,
    },
    title: { color: t.text, fontSize: 18, fontWeight: '700' },
    body: { color: t.textSecondary, fontSize: 14, textAlign: 'center', lineHeight: 20 },
    primaryBtn: {
      backgroundColor: t.primary,
      paddingHorizontal: 24,
      paddingVertical: 12,
      borderRadius: 10,
      marginTop: 8,
      minHeight: 44,
      justifyContent: 'center',
    },
    primaryBtnText: { color: '#ffffff', fontSize: 14, fontWeight: '700' },
    textBtn: { paddingHorizontal: 24, paddingVertical: 12, minHeight: 44, justifyContent: 'center' },
    textBtnText: { color: t.primaryLight, fontSize: 14, fontWeight: '600' },
  });
}
