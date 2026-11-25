/**
 * app/in-progress/[bountyId]/hunter — the hunter's workspace for one job
 * (Focus-first "both sides" handoff).
 *
 * Steps with their own screen are forwarded there, as before: chosen and
 * working → work-in-progress (H.5 / H.7), work sent and waiting → payout
 * (H.9), approved → payout (H.10). Every other state renders here, in place,
 * with the shared workspace layout: an offer waiting for an answer (H.3), an
 * offer that didn't go ahead (X.1), and anything else in the lifecycle's own
 * words — never a router.back() dead end.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { HunterStageScreen } from '../../../../components/hunter/hunter-stage-view';
import { useHunterHelp } from '../../../../components/hunter/use-hunter-help';
import { NotFoundScreen } from '../../../../components/not-found-screen';
import { NoteBox, PosterButton } from '../../../../components/poster';
import { useConfirmDialog, withdrawOfferCopy } from '../../../../components/poster/confirm-dialog';
import { HunterDashboardSkeleton } from '../../../../components/ui/skeleton-loaders';
import { useAuthContext } from '../../../../hooks/use-auth-context';
import { useBountyLifecycle } from '../../../../hooks/useBountyLifecycle';
import { usePayingSlow } from '../../../../hooks/usePayingSlow';
import { firstName } from '../../../../lib/my-jobs/format';
import { useWorksBothSides } from '../../../../lib/my-jobs/side-labels-store';
import { bountyAppTabPath } from '../../../../lib/navigation/bounty-app-tab';
import { ROUTES } from '../../../../lib/routes';
import { discardApplication, withdrawApplication } from '../../../../lib/services/application-withdrawal';
import { bountyRequestService } from '../../../../lib/services/bounty-request-service';
import { trackWorkspacePrimaryTapped } from '../../../../lib/services/focus-analytics';
import { useAppThemeContext } from '../../../../lib/themes/AppThemeContext';
import { getUserFriendlyError } from '../../../../lib/utils/error-messages';
import { describeHunterStage, type HunterActionKey } from '../../../../lib/utils/hunter-stage-copy';

const FEED_ROUTE = `${ROUTES.TABS.BOUNTY_APP}?tab=bounty`;
const MY_JOBS_ROUTE = bountyAppTabPath('messages', 'inProgress');

export default function HunterFlowIndex() {
  const { bountyId, sent } = useLocalSearchParams<{ bountyId?: string; sent?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // Until the session restores every viewer looks anonymous, which would
  // resolve an accepted hunter to a visitor and forward them to the wrong
  // screen. Hold the skeleton instead.
  const { session, isLoading: isAuthLoading } = useAuthContext();
  const currentUserId = session?.user?.id ?? null;
  const { theme } = useAppThemeContext();
  const worksBothSides = useWorksBothSides(currentUserId);

  const routeBountyId = useMemo(() => {
    const raw = Array.isArray(bountyId) ? bountyId[0] : bountyId;
    return raw && String(raw).trim().length > 0 ? String(raw) : null;
  }, [bountyId]);

  const {
    bounty,
    role,
    state,
    otherParty,
    requestStatus,
    requestRejectionSource,
    submission,
    hasDispute,
    disputeId,
    isLoading,
    error,
    notFound,
    refresh,
  } = useBountyLifecycle(routeBountyId, currentUserId);

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [busyAction, setBusyAction] = useState<HunterActionKey | null>(null);
  const { ask, dialog: confirmDialog } = useConfirmDialog();
  const [toast, setToast] = useState<string | null>(null);
  const [yourNote, setYourNote] = useState<string | null>(null);

  // Forward only when there is a dedicated screen for the state. Everything
  // else is rendered below rather than bounced.
  const forwardTarget = useMemo(() => {
    if (!bounty || !routeBountyId) return null;
    if (role === 'poster') return { pathname: '/postings/[bountyId]', params: { bountyId: routeBountyId } };
    if (requestStatus === 'accepted' && currentUserId && String(bounty.accepted_by ?? '') === String(currentUserId)) {
      if (
        bounty.status === 'completed' ||
        (bounty.status === 'archived' && !!(bounty as any).completed_at) ||
        state?.status === 'submitted_for_review'
      ) {
        return { pathname: '/in-progress/[bountyId]/hunter/payout', params: { bountyId: routeBountyId } };
      }
      if (bounty.status === 'in_progress') {
        return { pathname: '/in-progress/[bountyId]/hunter/work-in-progress', params: { bountyId: routeBountyId } };
      }
    }
    return null;
  }, [bounty, role, requestStatus, routeBountyId, currentUserId, state?.status]);

  React.useEffect(() => {
    if (isAuthLoading || isLoading || !forwardTarget) return;
    router.replace(forwardTarget as never);
  }, [isAuthLoading, isLoading, forwardTarget, router]);

  // H.3: "Offer sent to Jordan." when arriving from the offer sheet.
  const posterFirst = firstName(otherParty.name);
  React.useEffect(() => {
    if (sent === 'offer' && state?.status === 'applied') setToast(`Offer sent to ${posterFirst ?? 'the poster'}.`);
  }, [sent, state?.status, posterFirst]);

  // H.3: the note the hunter sent with the offer.
  React.useEffect(() => {
    let active = true;
    if (!routeBountyId || !currentUserId || state?.status !== 'applied') return;
    bountyRequestService
      .getAll({ bountyId: routeBountyId, userId: currentUserId })
      .then((rows) => {
        if (active) setYourNote(((rows ?? [])[0] as any)?.message?.trim() || null);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [routeBountyId, currentUserId, state?.status]);

  const onRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await refresh();
    } finally {
      setIsRefreshing(false);
    }
  }, [refresh]);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace(MY_JOBS_ROUTE as never);
  }, [router]);

  const openThread = useCallback(() => {
    if (!routeBountyId) return;
    router.push({ pathname: '/tabs/bounty-thread/[bountyId]', params: { bountyId: routeBountyId, role: 'hunter' } } as never);
  }, [routeBountyId, router]);

  // S.3, the same confirmation My Jobs uses. withdrawApplication only works
  // for a pending offer; a chosen one gets its clear error.
  const handleWithdraw = useCallback(() => {
    if (!routeBountyId) return;
    ask({
      ...withdrawOfferCopy(posterFirst),
      onConfirm: async () => {
        setBusyAction('withdraw');
        try {
          // TODO(E): a withdrawn offer is deleted, so "Your offers" can't list
          // it (S.2), and the poster isn't told (S.3).
          await withdrawApplication({ bountyId: routeBountyId, currentUserId: currentUserId ?? undefined, surface: 'hunter_detail' });
          router.replace(MY_JOBS_ROUTE as never);
        } catch (err: any) {
          Alert.alert('Could not withdraw', err?.message || 'Please try again.');
        } finally {
          setBusyAction(null);
        }
      },
    });
  }, [routeBountyId, posterFirst, currentUserId, router, ask]);

  const handleDiscardApplication = useCallback(() => {
    if (!routeBountyId) return;
    Alert.alert(
      'Remove from my list?',
      "This job will be removed from your list. This can't be undone.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setBusyAction('remove');
            try {
              await discardApplication({ bountyId: routeBountyId, currentUserId: currentUserId ?? undefined, surface: 'hunter_detail' });
              // The bounty is now hidden from this hunter's list, so leave the screen.
              router.replace(MY_JOBS_ROUTE as never);
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

  // The lifecycle's actions that still have a home here.
  const handlers = useMemo(() => {
    if (!routeBountyId) return {};
    return {
      find_bounties: () => router.replace(FEED_ROUTE as never),
      view_bounty: () => router.push({ pathname: '/bounty/[id]/public', params: { id: routeBountyId } } as never),
      discard_application: handleDiscardApplication,
      view_dispute: () =>
        disputeId
          ? router.push(`/dispute/${disputeId}` as never)
          : router.push({ pathname: '/bounty/[id]/dispute', params: { id: routeBountyId } } as never),
      // The real support form, not /tabs/need-help-screen (the Post-a-Bounty
      // composer), with the job attached so support knows which one.
      contact_support: () =>
        router.push({
          pathname: '/support/contact',
          params: { bountyId: routeBountyId, bountyTitle: bounty?.title ?? '' },
        } as never),
    };
  }, [routeBountyId, bounty?.title, handleDiscardApplication, router, disputeId]);

  const help = useHunterHelp({
    bountyId: routeBountyId,
    posterName: posterFirst,
    working: false,
    workSubmitted: false,
    disputeOpen: hasDispute,
    heldAmount: null,
    openThread,
    requestCancellation: () => {},
    contactSupport: () => handlers.contact_support?.(),
  });

  // Approved and paying: "We're confirming the payment" after PAYING_SLOW_AFTER_MS.
  const payingSlow = usePayingSlow(!!state?.paying, routeBountyId);
  const view = useMemo(() => {
    if (!bounty || !state) return null;
    return describeHunterStage({
      bounty: bounty as any,
      lifecycle: state,
      posterName: otherParty.name,
      requestStatus,
      requestRejectionSource,
      submission,
      hasDispute,
      payingSlow,
    });
  }, [bounty, state, otherParty.name, requestStatus, requestRejectionSource, submission, hasDispute, payingSlow]);

  const onAction = useCallback(
    (key: HunterActionKey) => {
      if (!routeBountyId || !view) return;
      if (view.primary?.key === key) trackWorkspacePrimaryTapped({ bountyId: routeBountyId, side: 'doing', screenId: view.screenId, action: key });
      switch (key) {
        case 'back_to_jobs':
          goBack();
          return;
        case 'withdraw':
          handleWithdraw();
          return;
        case 'find_work':
          handlers.find_bounties?.();
          return;
        case 'remove':
          handleDiscardApplication();
          return;
        case 'message':
          openThread();
          return;
        case 'see_report':
        case 'add_info':
          handlers.view_dispute?.();
          return;
        default:
          return;
      }
    },
    [routeBountyId, view, goBack, handleWithdraw, handlers, handleDiscardApplication, openThread]
  );

  if (isAuthLoading || isLoading || forwardTarget) {
    return (
      <View style={[styles.flex, { paddingTop: insets.top, backgroundColor: theme.background }]}>
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

  if (error || !bounty || !state || !view) {
    return (
      <SafeAreaView style={[styles.centered, { backgroundColor: theme.poster.bg }]}>
        <NoteBox
          tone="e"
          icon="cloud-off"
          title={"Couldn't load this job"}
          text="You're offline or the connection dropped."
          text2="Your offer and any work you've sent are unaffected."
        />
        <PosterButton label="Try again" icon="refresh" onPress={onRefresh} />
        <PosterButton kind="text" label="Go back" onPress={goBack} />
      </SafeAreaView>
    );
  }

  return (
    <HunterStageScreen
      view={view}
      bounty={bounty as any}
      posterName={otherParty.name}
      worksBothSides={worksBothSides}
      onBack={goBack}
      onAction={onAction}
      busyKey={busyAction}
      toast={toast}
      onToastHide={() => setToast(null)}
      yourNote={yourNote}
      refreshing={isRefreshing}
      onRefresh={onRefresh}
      help={help}
      moreExtra={
        view.screenId === 'X.1' || view.screenId === 'H.3'
          ? []
          : state.secondaryActions.some((a) => a.key === 'discard_application')
            ? [{ key: 'discard', label: 'Remove from my list', icon: 'delete-outline', danger: true, onPress: handleDiscardApplication }]
            : []
      }
    >
      {confirmDialog}
    </HunterStageScreen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', gap: 12, padding: 24 },
});
