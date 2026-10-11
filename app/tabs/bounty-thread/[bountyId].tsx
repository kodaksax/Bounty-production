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
import { AcceptFundingGate } from '../../../components/accept-funding-gate';
import { InteractiveMessageCard } from '../../../components/bounty-inbox/interactive-message-card';
import { StatusBadge } from '../../../components/bounty-inbox/status-badge';
import { SubmitWorkSheet } from '../../../components/bounty-inbox/submit-work-sheet';
import { PosterReviewModal } from '../../../components/poster-review-modal';
import { WorkflowDisputeModal } from '../../../components/workflow-dispute-modal';
import { useAuthContext } from '../../../hooks/use-auth-context';
import { useAcceptFunding } from '../../../hooks/useAcceptFunding';
import { useAcceptRequest } from '../../../hooks/useAcceptRequest';
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
import { useWallet } from '../../../lib/wallet-context';
import { ChatDetailScreen, type ChatTimelineItem } from '../chat-detail-screen';

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

  const [busyEventId, setBusyEventId] = useState<string | null>(null);
  const [showSubmit, setShowSubmit] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [showDispute, setShowDispute] = useState(false);
  const [startingChat, setStartingChat] = useState(false);

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
      Alert.alert('Cancellation requested', `Waiting on ${counterpartName} to respond to your request.`);
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
            setBusyEventId(event.id);
            try {
              await handleAcceptRequest(request.id);
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
          Alert.alert('Cancellation requested', `Waiting on ${counterpartName} to respond to your request.`);
          return;
        case 'view_dispute':
          if (dispute) router.push(`/dispute/${dispute.id}` as never);
          return;
      }
    },
    [bounty, request, counterpart?.id, counterpartName, dispute, handleAcceptRequest, handleRejectRequest, reload, router, viewerId]
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
      applicationCount: role === 'poster' && request?.status === 'pending' ? 1 : 0,
      hasDispute: hasActiveDispute,
      hasCancellationRequest: cancellation?.status === 'pending',
      cancellationRequestedByRole: cancellation?.requesterType ?? null,
      otherPartyName: counterpart?.name ?? null,
      submittedAt: submission?.submitted_at ?? null,
    });
  }, [bounty, role, viewerId, request, submission, hasActiveDispute, cancellation, counterpart?.name]);

  // The pay-at-accept gate takes over the screen while open, exactly as on
  // the old Requests list.
  if (acceptFundingGate.active) {
    return <AcceptFundingGate gate={acceptFundingGate} />;
  }

  if (thread.loading && !bounty) {
    return (
      <View style={[s.center, { backgroundColor: theme.background }]}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    );
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
        <ToolChip
          icon="visibility"
          label="Bounty details"
          onPress={() => router.push(`/bounty/${bounty.id}` as never)}
          theme={theme}
        />
        <ToolChip
          icon={hasActiveDispute ? 'gavel' : 'report-problem'}
          label={disputeLabel}
          tone="danger"
          dimmed={!hasHunter && !hasActiveDispute}
          onPress={openDispute}
          theme={theme}
        />
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
      <ChatDetailScreen
        key={conversation.id}
        conversation={conversation}
        onBack={() => router.back()}
        headerSubtitle={bounty.title}
        headerRight={
          <TouchableOpacity
            onPress={() => router.push(`/bounty/${bounty.id}` as never)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="View bounty details"
          >
            <MaterialIcons name="info-outline" size={22} color={theme.text} />
          </TouchableOpacity>
        }
        topBanner={topBanner}
        timelineItems={timelineItems}
        composerOverride={composerOverride}
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
          hunterId={String(bounty.accepted_by || counterpart?.id || '')}
          hunterName={counterpartName}
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
    bannerAmount: { color: t.primary, fontSize: 16, fontWeight: '800' },
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
      borderColor: 'rgba(0,142,42,0.6)',
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
