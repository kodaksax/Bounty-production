/**
 * app/in-progress/[bountyId]/hunter — the Hunter's entry point for one bounty.
 *
 * This used to be a pure router that called `router.back()` for every state it
 * didn't have a screen for: no application, a rejected application, a load
 * failure, a missing bounty. Reached from a notification or a deep link there
 * was nothing to go back TO, and reached from the public bounty view (whose
 * "View your application" button lands here) a rejected hunter bounced straight
 * back to the button that sent them — a loop with no explanation anywhere in it.
 *
 * It now still forwards to the active work screens when there is active work,
 * but every other state renders here, in place, with the same lifecycle copy
 * the poster is reading from their side: what happened, what it means, and
 * where to go next.
 */
import { MaterialIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { NotFoundScreen } from '../../../../components/not-found-screen';
import { BountyStatusPanel } from '../../../../components/ui/bounty-status-panel';
import { Stepper } from '../../../../components/ui/stepper';
import { HunterDashboardSkeleton } from '../../../../components/ui/skeleton-loaders';
import { useAuthContext } from '../../../../hooks/use-auth-context';
import { useBountyLifecycle } from '../../../../hooks/useBountyLifecycle';
import { getUserFriendlyError } from '../../../../lib/utils/error-messages';
import { ROUTES } from '../../../../lib/routes';
import { discardApplication } from '../../../../lib/services/application-withdrawal';
import { messageService } from '../../../../lib/services/message-service';
import { useAppThemeContext } from '../../../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../../../lib/themes/types';
import type { BountyActionKey } from '../../../../lib/utils/bounty-lifecycle';
import { getBountyStages } from '../../../../lib/utils/bounty-lifecycle';

const FEED_ROUTE = `${ROUTES.TABS.BOUNTY_APP}?screen=bounty`;
const MY_WORK_ROUTE = `${ROUTES.TABS.BOUNTY_APP}?screen=messages&initialTab=inProgress`;

export default function HunterFlowIndex() {
  const { bountyId } = useLocalSearchParams<{ bountyId?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // Until the session restores every viewer looks anonymous, which would
  // resolve an accepted hunter to a visitor and forward them to the wrong
  // screen. Hold the skeleton instead.
  const { session, isLoading: isAuthLoading } = useAuthContext();
  const currentUserId = session?.user?.id ?? null;
  const { theme } = useAppThemeContext();
  const s = useMemo(() => makeStyles(theme), [theme]);

  const routeBountyId = useMemo(() => {
    const raw = Array.isArray(bountyId) ? bountyId[0] : bountyId;
    return raw && String(raw).trim().length > 0 ? String(raw) : null;
  }, [bountyId]);

  const { bounty, role, state, otherParty, requestStatus, isLoading, error, notFound, refresh } =
    useBountyLifecycle(routeBountyId, currentUserId);

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [busyAction, setBusyAction] = useState<BountyActionKey | null>(null);

  // Forward only when there is a dedicated screen for the state. Everything
  // else is rendered below rather than bounced.
  const forwardTarget = useMemo(() => {
    if (!bounty || !routeBountyId) return null;
    if (role === 'poster') return { pathname: '/postings/[bountyId]', params: { bountyId: routeBountyId } };
    if (requestStatus === 'accepted') {
      if (bounty.status === 'completed')
        return { pathname: '/in-progress/[bountyId]/hunter/payout', params: { bountyId: routeBountyId } };
      if (bounty.status === 'in_progress')
        return {
          pathname: '/in-progress/[bountyId]/hunter/work-in-progress',
          params: { bountyId: routeBountyId },
        };
    }
    return null;
  }, [bounty, role, requestStatus, routeBountyId]);

  React.useEffect(() => {
    if (isAuthLoading || isLoading || !forwardTarget) return;
    router.replace(forwardTarget as never);
  }, [isAuthLoading, isLoading, forwardTarget, router]);

  const onRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await refresh();
    } finally {
      setIsRefreshing(false);
    }
  }, [refresh]);

  const handleMessage = useCallback(async () => {
    if (!bounty || !otherParty.id) {
      Alert.alert('No conversation yet', 'There is no one to message on this bounty right now.');
      return;
    }
    setBusyAction('message');
    try {
      const conversation = await messageService.getOrCreateConversation(
        [String(otherParty.id)],
        '',
        String(bounty.id)
      );
      if (!conversation?.id) throw new Error('no conversation');
      router.push(`/tabs/messenger/${encodeURIComponent(String(conversation.id))}` as never);
    } catch {
      Alert.alert(
        "Couldn't open the conversation",
        'Check your connection and try again — nothing was lost.'
      );
    } finally {
      setBusyAction(null);
    }
  }, [bounty, otherParty.id, router]);

  const handleDiscardApplication = useCallback(() => {
    if (!routeBountyId) return;
    Alert.alert(
      'Discard Application',
      "Remove this rejected application from your list? This can't be undone.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: async () => {
            setBusyAction('discard_application');
            try {
              await discardApplication({
                bountyId: routeBountyId,
                currentUserId: currentUserId ?? undefined,
                surface: 'hunter_detail',
              });
              // The application row (and with it, this hunter's reason to be on
              // this screen) is gone — there is nothing left here to refresh.
              router.replace(MY_WORK_ROUTE as never);
            } catch (err) {
              const friendly = getUserFriendlyError(err);
              Alert.alert(friendly.title, friendly.message);
            } finally {
              setBusyAction(null);
            }
          },
        },
      ],
      { cancelable: true }
    );
  }, [routeBountyId, currentUserId, router]);

  const handlers = useMemo((): Partial<Record<BountyActionKey, () => void>> => {
    if (!routeBountyId) return {};
    return {
      find_bounties: () => router.replace(FEED_ROUTE as never),
      view_bounty: () =>
        router.push({ pathname: '/bounty/[id]/public', params: { id: routeBountyId } } as never),
      apply: () =>
        router.push({ pathname: '/bounty/[id]/public', params: { id: routeBountyId } } as never),
      message: handleMessage,
      discard_application: handleDiscardApplication,
      view_dispute: () =>
        router.push({ pathname: '/bounty/[id]/dispute', params: { id: routeBountyId } } as never),
      open_dispute: () =>
        router.push({ pathname: '/bounty/[id]/dispute', params: { id: routeBountyId } } as never),
      respond_cancellation: () =>
        router.push({
          pathname: '/bounty/[id]/cancellation-response',
          params: { id: routeBountyId },
        } as never),
      // The hunter is the only party who can ASK to cancel: this is their exit
      // from work they can't finish. Approving it returns the poster's escrow
      // in full, so it goes through the request/approve flow rather than
      // cancelling anything outright.
      cancel_bounty: () =>
        router.push({ pathname: '/bounty/[id]/cancel', params: { id: routeBountyId } } as never),
      contact_support: () => router.push('/tabs/need-help-screen' as never),
    };
  }, [routeBountyId, handleMessage, handleDiscardApplication, router]);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace(MY_WORK_ROUTE as never);
  }, [router]);

  if (isAuthLoading || isLoading || forwardTarget) {
    return (
      <View style={[s.container, { paddingTop: insets.top }]}>
        <HunterDashboardSkeleton />
      </View>
    );
  }

  if (notFound) {
    return (
      <NotFoundScreen
        title="This bounty is gone"
        message="The poster removed it, or the link points somewhere that no longer exists."
        icon="search-off"
        actionText="Find other bounties"
        onAction={() => router.replace(FEED_ROUTE as never)}
      />
    );
  }

  if (error || !bounty || !state) {
    return (
      <SafeAreaView style={s.centered}>
        <MaterialIcons name="cloud-off" size={48} color={theme.textSecondary} />
        <Text style={s.errorTitle}>{"Couldn't load this bounty"}</Text>
        <Text style={s.centeredText}>
          {"You're offline or the connection dropped. Your application and any work you've submitted are unaffected."}
        </Text>
        <TouchableOpacity style={s.retryButton} onPress={onRefresh}>
          <Text style={s.retryButtonText}>Try again</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.textButton} onPress={goBack}>
          <Text style={s.textButtonText}>Go back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const stages = getBountyStages(role === 'poster' ? 'poster' : 'hunter');

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      <View style={s.header}>
        <TouchableOpacity
          style={s.headerIcon}
          onPress={goBack}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <MaterialIcons name="arrow-back" size={24} color={theme.text} />
        </TouchableOpacity>
        <Text style={s.headerTitle} numberOfLines={1}>
          Your application
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
            tintColor={theme.text}
            colors={[theme.primary]}
          />
        }
      >
        <View style={s.heroCard}>
          <Text style={s.heroTitle} numberOfLines={3}>
            {bounty.title}
          </Text>
          <View style={s.heroMetaRow}>
            {bounty.is_for_honor ? (
              <Text style={s.heroAmount}>For honor</Text>
            ) : (
              <Text style={s.heroAmount}>${bounty.amount}</Text>
            )}
            {!!otherParty.name && <Text style={s.mutedSmall}>Posted by {otherParty.name}</Text>}
          </View>
        </View>

        <BountyStatusPanel
          state={state}
          role="hunter"
          otherPartyName={otherParty.name}
          onAction={handlers}
          busyAction={busyAction}
        />

        <View style={s.card}>
          <Text style={s.sectionTitle}>Where this stands</Text>
          <Stepper stages={stages} activeIndex={state.stageIndex} variant="compact" />
        </View>

        {!!bounty.description && (
          <View style={s.card}>
            <Text style={s.sectionTitle}>What was asked for</Text>
            <Text style={s.cardBody}>{bounty.description}</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: t.background },
    centered: {
      flex: 1,
      backgroundColor: t.background,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12,
      padding: 32,
    },
    centeredText: { color: t.textSecondary, fontSize: 14, textAlign: 'center', lineHeight: 20 },
    errorTitle: { color: t.text, fontSize: 18, fontWeight: '700' },
    retryButton: {
      backgroundColor: t.primary,
      paddingHorizontal: 24,
      paddingVertical: 12,
      borderRadius: 10,
      marginTop: 8,
      minHeight: 44,
      justifyContent: 'center',
    },
    retryButtonText: { color: '#ffffff', fontSize: 14, fontWeight: '700' },
    textButton: { paddingHorizontal: 24, paddingVertical: 12, minHeight: 44, justifyContent: 'center' },
    textButtonText: { color: t.primaryLight, fontSize: 14, fontWeight: '600' },

    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 8,
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: t.border,
    },
    headerIcon: {
      padding: 10,
      minWidth: 44,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerTitle: { flex: 1, color: t.text, fontSize: 17, fontWeight: '700' },

    content: { padding: 16 },
    heroCard: {
      backgroundColor: t.surface,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: t.border,
      padding: 16,
      marginBottom: 16,
      gap: 8,
    },
    heroTitle: { color: t.text, fontSize: 19, fontWeight: '700', lineHeight: 25 },
    heroMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
    heroAmount: { color: t.text, fontSize: 18, fontWeight: '800' },
    mutedSmall: { color: t.textSecondary, fontSize: 12 },

    card: {
      backgroundColor: t.surface,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: t.border,
      padding: 16,
      marginBottom: 16,
      gap: 10,
    },
    sectionTitle: { color: t.text, fontSize: 15, fontWeight: '700' },
    cardBody: { color: t.text, fontSize: 14, lineHeight: 20 },
  });
}
