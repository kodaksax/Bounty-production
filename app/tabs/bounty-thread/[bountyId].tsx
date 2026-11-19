/**
 * A bounty thread in the My Bounties tab: the DM between a hunter and a poster
 * about one bounty, with each workflow step rendered as an interactive card
 * (see components/bounty-inbox/interactive-message-card.tsx) between the
 * ordinary messages.
 *
 * Params:
 *   bountyId — the bounty.
 *   role     — 'hunter' (My Work) or 'poster' (My Bounties).
 *   with     — poster side only: the hunter this thread is with. Omitted for an
 *              open bounty nobody has applied to yet.
 *
 * Every action routes to the code path that already owned it — the accept /
 * reject hooks, completionService, PosterReviewModal, the dispute and
 * cancellation screens — so this screen changes presentation, not behaviour.
 */
import { MaterialIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { ScreenLoader } from '../../../components/ui/screen-loader';
import { AcceptFundingGate } from '../../../components/accept-funding-gate';
import { InteractiveMessageCard } from '../../../components/bounty-inbox/interactive-message-card';
import { StatusBadge } from '../../../components/bounty-inbox/status-badge';
import { SubmitWorkSheet } from '../../../components/bounty-inbox/submit-work-sheet';
import { PosterReviewModal } from '../../../components/poster-review-modal';
import { GetHelpSheet, type HelpRoute } from '../../../components/poster-job/get-help-sheet';
import { HireConfirmation } from '../../../components/poster-job/hire-confirmation';
import { WorkflowDisputeModal } from '../../../components/workflow-dispute-modal';
import { useAuthContext } from '../../../hooks/use-auth-context';
import { useAcceptFunding } from '../../../hooks/useAcceptFunding';
import { useAcceptRequest } from '../../../hooks/useAcceptRequest';
import { useApplicationDecisionVisit } from '../../../hooks/useApplicationDecisionVisit';
import { useBountyThread } from '../../../hooks/useBountyThread';
import { useRejectRequest } from '../../../hooks/useRejectRequest';
import { useValidUserId } from '../../../hooks/useValidUserId';
import { ErrorBoundary } from '../../../lib/error-boundary';
import { discardApplication, withdrawApplication } from '../../../lib/services/application-withdrawal';
import { bountyRequestService } from '../../../lib/services/bounty-request-service';
import * as supabaseMessaging from '../../../lib/services/supabase-messaging';
import { useAppThemeContext } from '../../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../../lib/themes/types';
import type { Conversation } from '../../../lib/types';
import { resolveBountyLifecycle } from '../../../lib/utils/bounty-lifecycle';
import type {
  BountyThreadAction,
  BountyThreadEvent,
  BountyThreadRole,
} from '../../../lib/utils/bounty-thread-events';
import { hideBountyForHunter } from '../../../lib/utils/hunter-hidden-bounties';
import { isPhase2Bounty, isV3Bounty } from '../../../lib/utils/payment-architecture';
import { derivePosterMoney, describePosterMoney } from '../../../lib/utils/poster-plain-copy';
import { useWallet } from '../../../lib/wallet-context';
import { ChatDetailScreen, type ChatTimelineItem } from '../chat-detail-screen';
import { withAlpha } from '../../../lib/utils';
import { showToast } from '../../../lib/toast';

export default function BountyThreadRoute() {
  return (
    <ErrorBoundary boundaryName="bounty_thread">
      <BountyThreadScreen />
    </ErrorBoundary>
  );
}

const noop = () => {};

function BountyThreadScreen() {
  const params = useLocalSearchParams<{ bountyId: string; role?: string; with?: string }>();
  const bountyId = String(params.bountyId ?? '');
  const role: BountyThreadRole = params.role === 'poster' ? 'poster' : 'hunter';
  const router = useRouter();
  const viewerId = useValidUserId();
  const { theme } = useAppThemeContext();
  const s = useMemo(() => makeStyles(theme), [theme]);

  const thread = useBountyThread({
    bountyId,
    role,
    viewerId: viewerId ?? null,
    counterpartId: role === 'poster' ? params.with ?? null : null,
  });
  const { bounty, request, submission, counterpart, events, hasActiveDispute, dispute, cancellation } = thread;
  // The bounty's real pending-offer count (the job page and Inbox count the
  // same rows), replacing a hard-coded 1. If that read failed, this thread's
  // own pending offer is the one thing known for sure, so it never says 0
  // while an offer is on screen. The bounty_requests realtime subscription
  // reloads it after any accept, pass or withdrawal.
  const thisOfferPending = role === 'poster' && request?.status === 'pending';
  const posterOfferCount =
    role !== 'poster'
      ? 0
      : Math.max(thread.pendingOfferCount ?? 0, thisOfferPending ? 1 : 0);

  const [busyEventId, setBusyEventId] = useState<string | null>(null);
  const [showSubmit, setShowSubmit] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [showDispute, setShowDispute] = useState(false);
  const [startingChat, setStartingChat] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  // Set only from a server-confirmed hire (useAcceptRequest's outcome).
  const [hiredName, setHiredName] = useState<string | null>(null);

  // ---- Accept / reject (poster) — the same hooks the Requests list used ----
  const { refreshFromApi } = useWallet();
  const { session } = useAuthContext();
  const refreshWallet = useCallback(async () => {
    if (!session?.access_token) return;
    await refreshFromApi(session.access_token, { silent: true, force: true });
  }, [session?.access_token, refreshFromApi]);
  const { gate: acceptFundingGate, ensureFunded, handleAcceptFailure } = useAcceptFunding();
  const bountyRequests = useMemo(() => (request ? [request] : []), [request]);
  const reload = thread.refresh;
  const reloadForRequests = useCallback(async () => reload(), [reload]);
  // The shared accept/reject hooks report unexpected failures through
  // setError (the old list rendered it as a banner); surface them here.
  const [localError, setLocalError] = useState<string | null>(null);
  useEffect(() => {
    if (!localError) return;
    Alert.alert('Something went wrong', localError);
    setLocalError(null);
  }, [localError]);

  const { handleAcceptRequest } = useAcceptRequest({
    currentUserId: viewerId ?? undefined,
    bountyRequests,
    myBounties: bounty ? [bounty] : [],
    setBountyRequests: noop as any,
    setMyBounties: noop as any,
    setInProgressBounties: noop as any,
    setIsLoading: noop as any,
    setError: setLocalError,
    loadMyBounties: reload,
    loadInProgress: reload,
    loadRequestsForMyBounties: reloadForRequests,
    setActiveScreen: () => router.back(),
    ensureFunded,
    refreshWallet,
    handleAcceptFailure,
    showSuccessAlert: false,
  });
  const { handleRejectRequest } = useRejectRequest({
    bountyRequests,
    setBountyRequests: noop as any,
    setIsLoading: noop as any,
    setError: setLocalError,
  });

  // application_viewed on arrival, application_dismissed if the poster leaves
  // without accepting, passing or messaging (acceptance root-cause analytics).
  const { markEngaged } = useApplicationDecisionVisit({
    request,
    enabled: role === 'poster' && request?.status === 'pending',
  });

  // ---- New-card pop-in: cards present on first load stay put, except the
  // one waiting on the viewer, which pops to draw the eye. ----
  const seenIds = useRef<Set<string> | null>(null);
  const [popIds, setPopIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (events.length === 0) return;
    if (seenIds.current === null) {
      seenIds.current = new Set(events.map(e => e.id));
      setPopIds(new Set(events.filter(e => e.yourTurn).map(e => e.id)));
      return;
    }
    const fresh = events.filter(e => !seenIds.current!.has(e.id)).map(e => e.id);
    if (fresh.length) {
      fresh.forEach(id => seenIds.current!.add(id));
      setPopIds(prev => new Set([...prev, ...fresh]));
    }
  }, [events]);

  const counterpartName = counterpart?.name ?? (role === 'poster' ? 'Your hunter' : 'The poster');
  const assignedHelper =
    role === 'poster' &&
    !!bounty?.accepted_by &&
    String(bounty.accepted_by) === String(counterpart?.id)
      ? counterpart
      : null;
  const isAcceptedHunter =
    role === 'hunter' && !!bounty?.accepted_by && String(bounty.accepted_by) === String(viewerId);
  const hasHunter = !!bounty?.accepted_by && (role === 'hunter' ? isAcceptedHunter : true);
  const isWorking = bounty?.status === 'in_progress' || bounty?.status === 'cancellation_requested';

  // ---- Dispute (both roles) & cancellation (hunter only) ----
  const openDispute = useCallback(() => {
    if (!bounty) return;
    if (dispute && hasActiveDispute) {
      router.push(`/dispute/${dispute.id}` as never);
      return;
    }
    if (!hasHunter) {
      Alert.alert(
        'Nothing to dispute yet',
        role === 'poster'
          ? 'You can raise a dispute once you have hired a hunter for this bounty.'
          : 'You can raise a dispute once the poster has hired you.'
      );
      return;
    }
    if (bounty.status === 'in_progress') {
      setShowDispute(true);
      return;
    }
    router.push(
      (role === 'hunter' ? `/bounty/${bounty.id}/dispute?from=in-progress` : `/bounty/${bounty.id}/dispute`) as never
    );
  }, [bounty, dispute, hasActiveDispute, hasHunter, role, router]);

  const requestCancellation = useCallback(() => {
    if (!bounty) return;
    if (bounty.status === 'cancellation_requested' || cancellation?.status === 'pending') {
      showToast({ message: `Waiting on ${counterpartName} to respond to your request.` });
      return;
    }
    if (hasActiveDispute) {
      Alert.alert('Dispute open', 'A dispute is open for this bounty, so it will be settled there instead.');
      return;
    }
    if (!isAcceptedHunter || bounty.status !== 'in_progress') {
      Alert.alert(
        'Not available',
        'You can request a cancellation once you have been hired and the bounty is in progress.'
      );
      return;
    }
    router.push({ pathname: '/bounty/[id]/cancel', params: { id: String(bounty.id) } } as never);
  }, [bounty, cancellation?.status, counterpartName, hasActiveDispute, isAcceptedHunter, router]);

  // ---- Card actions ----
  const onCardAction = useCallback(
    async (action: BountyThreadAction, event: BountyThreadEvent, choice?: 'accept' | 'decline') => {
      if (!bounty) return;
      const id = String(bounty.id);
      switch (action) {
        case 'accept_or_decline': {
          if (!request) return;
          if (choice === 'accept') {
            markEngaged('accept');
            setBusyEventId(event.id);
            try {
              const outcome = await handleAcceptRequest(request.id);
              if (outcome?.accepted) setHiredName(outcome.hunterName || counterpartName);
            } finally {
              setBusyEventId(null);
              reload();
            }
            return;
          }
          Alert.alert('Pass on this hunter?', `${counterpartName}'s application will be declined.`, [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Pass',
              style: 'destructive',
              onPress: async () => {
                markEngaged('decline');
                setBusyEventId(event.id);
                try {
                  await handleRejectRequest(request.id);
                  const remaining = await bountyRequestService
                    .getAll({ bountyId: id, userId: counterpart?.id })
                    .catch(() => null);
                  if (remaining && remaining.length === 0) router.back();
                  else reload();
                } finally {
                  setBusyEventId(null);
                }
              },
            },
          ]);
          return;
        }
        case 'withdraw':
          Alert.alert('Withdraw application', 'Are you sure you want to withdraw your application?', [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Withdraw',
              style: 'destructive',
              onPress: async () => {
                setBusyEventId(event.id);
                try {
                  await withdrawApplication({ bountyId: id, currentUserId: viewerId ?? undefined, surface: 'inbox' });
                  router.back();
                } catch (err: any) {
                  Alert.alert('Could not withdraw', err?.message || 'Please try again.');
                } finally {
                  setBusyEventId(null);
                }
              },
            },
          ]);
          return;
        case 'dismiss':
          Alert.alert('Remove from list', 'Remove this bounty from your list? This cannot be undone.', [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Remove',
              style: 'destructive',
              onPress: async () => {
                try {
                  if (request?.status === 'rejected') {
                    await discardApplication({ bountyId: id, currentUserId: viewerId ?? undefined, surface: 'inbox' });
                  } else {
                    await hideBountyForHunter(viewerId, id);
                  }
                  router.back();
                } catch (err: any) {
                  Alert.alert('Could not remove', err?.message || 'Please try again.');
                }
              },
            },
          ]);
          return;
        case 'submit_work':
        case 'resubmit_work':
          setShowSubmit(true);
          return;
        case 'review_and_pay':
          setShowReview(true);
          return;
        case 'view_payout':
          router.push({ pathname: '/in-progress/[bountyId]/hunter/payout', params: { bountyId: id } } as never);
          return;
        case 'respond_cancellation':
          router.push(`/bounty/${id}/cancellation-response` as never);
          return;
        case 'view_cancellation':
          showToast({ message: `Waiting on ${counterpartName} to respond to your request.` });
          return;
        case 'view_dispute':
          if (dispute) router.push(`/dispute/${dispute.id}` as never);
          return;
      }
    },
    [bounty, request, counterpart?.id, counterpartName, dispute, handleAcceptRequest, handleRejectRequest, markEngaged, reload, router, viewerId]
  );

  const timelineItems: ChatTimelineItem[] = useMemo(() => {
    if (!bounty) return [];
    return events.map(e => ({
      id: `bounty-card:${e.id}`,
      createdAt: e.at,
      render: () => (
        <InteractiveMessageCard
          key={e.id}
          event={e}
          role={role}
          bounty={bounty}
          counterpartName={counterpartName}
          animateIn={popIds.has(e.id)}
          busy={busyEventId === e.id}
          onAction={onCardAction}
        />
      ),
    }));
  }, [bounty, events, role, counterpartName, popIds, busyEventId, onCardAction]);

  // ---- Conversation (the DM between the pair) ----
  const canStartChat = !!counterpart && (role === 'poster' || isAcceptedHunter);
  const startChat = useCallback(async () => {
    if (!viewerId || !counterpart || !bounty) return;
    setStartingChat(true);
    try {
      const conv = await supabaseMessaging.getOrCreateConversation(
        String(viewerId),
        String(counterpart.id),
        String(bounty.id)
      );
      thread.setConversation(conv);
    } catch (err: any) {
      Alert.alert('Message Failed', err?.message || 'We could not open a conversation. Please try again.');
    } finally {
      setStartingChat(false);
    }
  }, [viewerId, counterpart, bounty, thread]);

  const conversation: Conversation = useMemo(
    () =>
      thread.conversation ?? {
        id: `bounty-thread-${bountyId}`,
        isGroup: false,
        name: counterpart?.name ?? 'Your bounty',
        bountyId,
        participantIds: counterpart && viewerId ? [String(viewerId), counterpart.id] : viewerId ? [String(viewerId)] : [],
      },
    [thread.conversation, bountyId, counterpart, viewerId]
  );

  const lifecycle = useMemo(() => {
    if (!bounty) return null;
    return resolveBountyLifecycle({
      bounty: bounty as any,
      role,
      viewerId: viewerId ?? null,
      requestStatus: role === 'hunter' ? request?.status ?? null : null,
      requestRejectionSource: (request as any)?.rejection_source ?? null,
      submissionStatus: submission?.status ?? null,
      submissionIsMine: !!submission && String(submission.hunter_id) === String(viewerId),
      applicationCount: posterOfferCount,
      hasDispute: hasActiveDispute,
      hasCancellationRequest: cancellation?.status === 'pending',
      cancellationRequestedByRole: cancellation?.requesterType ?? null,
      otherPartyName: counterpart?.name ?? null,
      submittedAt: submission?.submitted_at ?? null,
    });
  }, [bounty, role, viewerId, request, submission, hasActiveDispute, cancellation, counterpart?.name, posterOfferCount]);

  // Where the poster's money is, for the help sheet. While the job is open and
  // nobody is chosen, this screen has no server read of whether a
  // pay-when-you-choose job was charged, so it says nothing rather than guess;
  // the job page answers that one.
  const posterMoneyLine = useMemo(() => {
    if (role !== 'poster' || !bounty) return null;
    if (bounty.status === 'open' && !bounty.accepted_by) return null;
    const money = derivePosterMoney({ bounty: bounty as any, openJobCharge: null });
    return describePosterMoney({
      money,
      amount: Number(bounty.amount) || 0,
      helperName: assignedHelper?.name ?? null,
      status: lifecycle?.status ?? 'in_progress',
      hired: !!bounty.accepted_by,
      hasDispute: hasActiveDispute,
      hasCancellationRequest: cancellation?.status === 'pending',
      offerCount: 0,
    });
  }, [role, bounty, assignedHelper?.name, lifecycle?.status, hasActiveDispute, cancellation?.status]);

  const onPosterHelpRoute = useCallback(
    (route: HelpRoute) => {
      setShowHelp(false);
      if (!bounty) return;
      const id = String(bounty.id);
      const goToReport = (reason?: string) =>
        router.push({ pathname: '/bounty/[id]/dispute', params: reason ? { id, reason } : { id } } as never);
      switch (route) {
        case 'message':
          if (!thread.conversation) void startChat();
          return;
        case 'no_show':
          goToReport('hunter_unresponsive');
          return;
        case 'missed_time':
          goToReport('missed_deadline');
          return;
        case 'work_quality':
          goToReport('work_quality');
          return;
        case 'cancel_hired':
          goToReport('other');
          return;
        case 'see_report':
          openDispute();
          return;
        case 'ask_to_finish':
          setShowReview(true);
          return;
        case 'cancel_open':
          // The job page owns taking a job down (it re-checks the money first).
          router.push({ pathname: '/postings/[bountyId]', params: { bountyId: id } } as never);
          return;
        case 'assist':
        case 'support':
          router.push({
            pathname: '/support/contact',
            params: { bountyId: id, bountyTitle: bounty.title ?? '', ...(route === 'assist' ? { topic: 'assist' } : {}) },
          } as never);
          return;
      }
    },
    [bounty, router, thread.conversation, startChat, openDispute]
  );

  // The pay-at-accept gate takes over the screen while open, exactly as on
  // the old Requests list.
  if (acceptFundingGate.active) {
    return <AcceptFundingGate gate={acceptFundingGate} />;
  }

  if (thread.loading && !bounty) {
    return <ScreenLoader />;
  }

  if (!bounty) {
    return (
      <View style={[s.center, { backgroundColor: theme.background }]}>
        <MaterialIcons name="error-outline" size={36} color={theme.textSecondary} />
        <Text style={s.centerText}>{thread.error || 'This bounty could not be loaded.'}</Text>
        <TouchableOpacity onPress={() => router.back()} style={s.centerBtn} accessibilityRole="button">
          <Text style={s.centerBtnText}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const disputeLabel = hasActiveDispute ? 'View dispute' : 'Raise dispute';
  const cancelPending = bounty.status === 'cancellation_requested' || cancellation?.status === 'pending';

  const topBanner = (
    <View style={s.banner}>
      <View style={s.bannerTop}>
        {lifecycle && <StatusBadge status={lifecycle.status} />}
        <Text style={s.bannerText} numberOfLines={1}>
          {lifecycle?.headline ?? bounty.title}
        </Text>
        <Text style={s.bannerAmount}>{bounty.is_for_honor ? 'Honor' : `$${bounty.amount}`}</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.toolRow}>
        {/* The poster's way to edit or cancel: Inbox rows open this thread,
            so the chip says where those actions live. */}
        <ToolChip
          icon={role === 'poster' ? 'tune' : 'visibility'}
          label={role === 'poster' ? 'Job details' : 'Bounty details'}
          onPress={() => router.push(`/bounty/${bounty.id}` as never)}
          theme={theme}
        />
        {role === 'poster' ? (
          // A red "Raise dispute" before anyone was hired read as an accusation
          // and a dead end. "Get help" opens the same help sheet as the job
          // page, with only the options that apply now.
          <ToolChip icon="support-agent" label="Get help" onPress={() => setShowHelp(true)} theme={theme} />
        ) : (
          <ToolChip
            icon={hasActiveDispute ? 'gavel' : 'report-problem'}
            label={disputeLabel}
            tone="danger"
            dimmed={!hasHunter && !hasActiveDispute}
            onPress={openDispute}
            theme={theme}
          />
        )}
        {role === 'hunter' && (
          <ToolChip
            icon={cancelPending ? 'hourglass-empty' : 'cancel'}
            label={cancelPending ? 'Cancellation pending' : 'Request cancellation'}
            tone="warning"
            dimmed={!isAcceptedHunter || !isWorking || hasActiveDispute}
            onPress={requestCancellation}
            theme={theme}
          />
        )}
      </ScrollView>
    </View>
  );

  const composerOverride = thread.conversation ? undefined : canStartChat ? (
    <TouchableOpacity
      style={s.startChat}
      onPress={startChat}
      disabled={startingChat}
      accessibilityRole="button"
      accessibilityLabel={`Message ${counterpartName}`}
    >
      {startingChat ? (
        <ActivityIndicator color="#fff" />
      ) : (
        <>
          <MaterialIcons name="chat-bubble" size={18} color="#fff" />
          <Text style={s.startChatText}>Message {counterpartName}</Text>
        </>
      )}
    </TouchableOpacity>
  ) : (
    <View style={s.lockedComposer}>
      <MaterialIcons name="lock-outline" size={16} color={theme.textSecondary} />
      <Text style={s.lockedText}>
        {counterpart
          ? `Chat opens once ${counterpartName} messages you or hires you.`
          : 'Applicants will show up in your inbox as soon as they apply.'}
      </Text>
    </View>
  );

  return (
    <>
      {/* Keyed on the bounty, not the conversation id. The placeholder id
          changes to the real id when the chat starts, and useMessages
          follows that change. A remount rebuilt the full thread instead. */}
      <ChatDetailScreen
        key={`bounty-thread:${bountyId}`}
        conversation={conversation}
        onBack={() => router.back()}
        headerSubtitle={bounty.title}
        headerRight={
          <TouchableOpacity
            onPress={() => router.push(`/bounty/${bounty.id}` as never)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel={role === 'poster' ? 'Job details' : 'View bounty details'}
          >
            <MaterialIcons name="info-outline" size={22} color={theme.text} />
          </TouchableOpacity>
        }
        topBanner={topBanner}
        timelineItems={timelineItems}
        composerOverride={composerOverride}
        onMessageSent={() => markEngaged('message')}
      />

      {role === 'hunter' && (
        <SubmitWorkSheet
          visible={showSubmit}
          bountyId={String(bounty.id)}
          bountyTitle={bounty.title}
          hunterId={viewerId ?? null}
          alreadyReady={!!thread.readyAt}
          hasDispute={hasActiveDispute}
          isResubmission={submission?.status === 'revision_requested'}
          initialMessage={submission?.status === 'revision_requested' ? submission.message : undefined}
          initialProofs={
            submission?.status === 'revision_requested' && Array.isArray(submission.proof_items)
              ? (submission.proof_items as any)
              : undefined
          }
          onClose={() => setShowSubmit(false)}
          onSubmitted={reload}
        />
      )}

      {role === 'poster' && (
        <PosterReviewModal
          visible={showReview}
          bountyId={String(bounty.id)}
          hunterId={String(bounty.accepted_by || assignedHelper?.id || '')}
          hunterName={assignedHelper?.name ?? 'Your hunter'}
          bountyAmount={bounty.amount || 0}
          isForHonor={!!bounty.is_for_honor}
          architecture={isV3Bounty(bounty) ? 'v3' : isPhase2Bounty(bounty) ? 'v2' : 'v1'}
          onClose={() => setShowReview(false)}
          onComplete={() => {
            setShowReview(false);
            reload();
          }}
        />
      )}

      {role === 'poster' && (
        <GetHelpSheet
          visible={showHelp}
          onClose={() => setShowHelp(false)}
          onRoute={onPosterHelpRoute}
          helperName={assignedHelper?.name ?? null}
          hired={!!bounty.accepted_by && bounty.status !== 'completed'}
          canTakeDown={bounty.status === 'open' && !bounty.accepted_by}
          awaitingApproval={bounty.status === 'in_progress' && submission?.status === 'pending'}
          hasDispute={hasActiveDispute && !!dispute}
          completed={bounty.status === 'completed'}
          moneyLine={posterMoneyLine}
        />
      )}

      {role === 'poster' && (
        <HireConfirmation
          visible={!!hiredName}
          helperName={hiredName ?? ''}
          isForHonor={!!bounty.is_for_honor}
          doneLabel="Back to the chat"
          onMessage={() => {
            setHiredName(null);
            if (!thread.conversation) void startChat();
          }}
          onDone={() => setHiredName(null)}
          isOpeningMessage={startingChat}
        />
      )}

      <WorkflowDisputeModal
        visible={showDispute}
        bountyId={String(bounty.id)}
        bountyTitle={bounty.title}
        initiatorId={String(viewerId || '')}
        respondentId={String(
          role === 'hunter' ? bounty.poster_id || bounty.user_id || '' : bounty.accepted_by || counterpart?.id || ''
        )}
        stage={bounty.status === 'in_progress' ? 'in_progress' : 'review_verify'}
        onClose={() => setShowDispute(false)}
        onDisputeCreated={disputeId => {
          setShowDispute(false);
          reload();
          Alert.alert('Dispute Filed', 'Your dispute has been submitted.', [
            { text: 'View', onPress: () => router.push(`/dispute/${disputeId}` as never) },
            { text: 'OK' },
          ]);
        }}
      />
    </>
  );
}

function ToolChip({
  icon,
  label,
  onPress,
  tone,
  dimmed,
  theme,
}: {
  icon: keyof typeof MaterialIcons.glyphMap;
  label: string;
  onPress: () => void;
  tone?: 'danger' | 'warning';
  dimmed?: boolean;
  theme: AppTheme;
}) {
  const color =
    tone === 'danger'
      ? theme.isDark ? '#fca5a5' : '#dc2626'
      : tone === 'warning'
        ? theme.isDark ? '#fcd34d' : '#b45309'
        : theme.isDark ? '#1FAE49' : theme.primary;
  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: dimmed }}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderRadius: 999,
        backgroundColor: theme.surfaceSecondary,
        borderWidth: 1,
        borderColor: theme.border,
        opacity: dimmed ? 0.5 : 1,
      }}
    >
      <MaterialIcons name={icon} size={15} color={color} />
      <Text style={{ color, fontSize: 13, fontWeight: '700' }}>{label}</Text>
    </TouchableOpacity>
  );
}

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
    centerText: { color: t.textSecondary, fontSize: 15, textAlign: 'center' },
    centerBtn: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 999, backgroundColor: t.primary },
    centerBtnText: { color: '#fff', fontWeight: '700' },
    banner: {
      paddingTop: 10,
      paddingBottom: 8,
      gap: 8,
      backgroundColor: t.background,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.border,
    },
    bannerTop: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 16,
    },
    bannerText: { flex: 1, color: t.text, fontSize: 13, fontWeight: '600' },
    bannerAmount: { color: t.primaryLight, fontSize: 16, fontWeight: '800' },
    toolRow: { gap: 8, paddingHorizontal: 16 },
    startChat: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      minHeight: 48,
      borderRadius: t.radius.lg,
      backgroundColor: t.primary,
      borderWidth: 1,
      borderColor: withAlpha(t.primary, 0.6),
      ...t.shadows.brand,
    },
    startChatText: { color: '#fff', fontSize: 15, fontWeight: '700' },
    lockedComposer: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      padding: 14,
      borderRadius: 16,
      backgroundColor: t.surfaceSecondary,
    },
    lockedText: { flex: 1, color: t.textSecondary, fontSize: 13 },
  });
}
