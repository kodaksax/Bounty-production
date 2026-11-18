/**
 * app/postings/[bountyId] — the poster's page for one job.
 *
 * It answers five questions without the poster having to go anywhere else:
 *   1. Who is doing the job?          "Who's doing the job" card
 *   2. What is happening now?         the next-step card's title and body
 *   3. What needs to happen next?     the next-step card's one primary action
 *   4. Where is my money?             the money sentence + the Payment card
 *   5. How do I get help?             "Get help with this job", on every state
 *
 * State still comes from the backend through useBountyLifecycle →
 * resolveBountyLifecycle. What the poster READS comes from
 * lib/utils/poster-plain-copy.ts, which rewrites that state without
 * marketplace words, and whose money sentence is fed only by the money state
 * this page verified (the server's funding read while the job is open; the
 * job's own escrow state after that).
 *
 * Offers are listed here, for this job only (usePosterJobOffers), so the
 * poster compares people on one screen instead of opening one chat per
 * person from a cross-job inbox. Choosing someone shows "You've chosen …"
 * only once the server confirmed the hire.
 *
 * Access: a non-poster is redirected to the view that is actually theirs.
 */
import { MaterialIcons } from '@expo/vector-icons';
import { saveStructuredBountyEdit } from '../../../lib/services/bounty-requirements-service';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { AcceptFundingGate } from '../../../components/accept-funding-gate';
import { EditPostingModal } from '../../../components/edit-posting-modal';
import { NotFoundScreen } from '../../../components/not-found-screen';
import { PosterReviewModal } from '../../../components/poster-review-modal';
import { GetHelpSheet, type HelpRoute } from '../../../components/poster-job/get-help-sheet';
import { HelperCard } from '../../../components/poster-job/helper-card';
import { HireConfirmation } from '../../../components/poster-job/hire-confirmation';
import { JobOffersSection } from '../../../components/poster-job/job-offers-section';
import { JobTimeline } from '../../../components/poster-job/job-timeline';
import { NextStepCard } from '../../../components/poster-job/next-step-card';
import { ScreenLoader } from '../../../components/ui/screen-loader';
import { useAuthContext } from '../../../hooks/use-auth-context';
import { formatExactAddress, useBountyExactLocation } from '../../../hooks/useBountyExactLocation';
import { useBountyLifecycle } from '../../../hooks/useBountyLifecycle';
import { usePosterJobOffers } from '../../../hooks/usePosterJobOffers';
import { useBackgroundColor } from '../../../lib/context/BackgroundColorContext';
import { bountyRequestService } from '../../../lib/services/bounty-request-service';
import { getBountyFundingRequirement } from '../../../lib/services/bounty-funding-service';
import { bountyService } from '../../../lib/services/bounty-service';
import type { Bounty } from '../../../lib/services/database.types';
import { messageService } from '../../../lib/services/message-service';
import {
  EMPTY_POSTER_JOB_ACTIVITY,
  getPosterJobActivity,
  type PosterJobActivity,
} from '../../../lib/services/poster-job-activity';
import { ratingsService } from '../../../lib/services/ratings';
import { useAppThemeContext } from '../../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../../lib/themes/types';
import type { AcceptRequestOutcome } from '../../../hooks/useAcceptRequest';
import { formatCategoryLabel } from '../../../lib/utils/data-utils';
import { isPhase2Bounty, isV3Bounty } from '../../../lib/utils/payment-architecture';
import {
  buildPosterTimeline,
  derivePosterMoney,
  describeUpcoming,
  formatAgo,
  formatDollars,
  posterNextStep,
  type OpenJobChargeState,
  type PosterActionKey,
  type PosterMoneyState,
} from '../../../lib/utils/poster-plain-copy';
import { formatPublicLocation } from '../../../lib/utils/public-location';
import { getTrustTierLabel } from '../../../lib/utils/trust-tier';
import { shareBounty } from '../../../lib/utils/share-utils';
import { bountyAppTabPath } from '../../../lib/navigation/bounty-app-tab';
import {
  BountyRefundFailedError,
  canPosterCancelBounty,
  cancelAndRefundBounty,
  describeCancelRefund,
  describeCancelRefundDone,
  planCancelRefund,
  type CancelRefundPlan,
} from '../../../lib/services/bounty-cancel-refund';
import { markBountyRemovedLocally } from '../../../lib/utils/bounty-visibility';
import { getUserFriendlyError } from '../../../lib/utils/error-messages';
import { useWallet } from '../../../lib/wallet-context';

/** The post-a-job flow. */
const POST_BOUNTY_ROUTE = bountyAppTabPath('postings');

type BusyKey = PosterActionKey | 'delete' | 'leave_review' | null;

export default function BountyDashboard() {
  const { bountyId, openEdit, openReview } = useLocalSearchParams<{
    bountyId?: string;
    openEdit?: string;
    /** 'true' opens the rating step (rating_reminder); 'work' opens the work review. */
    openReview?: string;
  }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // `isAuthLoading` matters here: on a cold start the session restores after
  // the first render, so a poster momentarily looks like a signed-out visitor.
  const { session, isLoading: isAuthLoading } = useAuthContext();
  const currentUserId = session?.user?.id ?? null;
  const { pushColor, popColor } = useBackgroundColor();
  const { theme } = useAppThemeContext();
  const s = useMemo(() => makeStyles(theme), [theme]);

  const routeBountyId = useMemo(() => {
    const raw = Array.isArray(bountyId) ? bountyId[0] : bountyId;
    return raw && String(raw).trim().length > 0 ? String(raw) : null;
  }, [bountyId]);

  const {
    bounty,
    role,
    state,
    otherParty,
    applicationCount,
    submission,
    hasDispute,
    disputeId,
    hasCancellationRequest,
    cancellationRequestedByRole,
    isLoading,
    error,
    notFound,
    refresh,
  } = useBountyLifecycle(routeBountyId, currentUserId);

  // Poster sees their own exact address; bounty.location is only the public label.
  const { exact: exactLocation } = useBountyExactLocation(bounty?.id, role === 'poster');
  const locationText = formatExactAddress(exactLocation) || (bounty ? formatPublicLocation(bounty) : null);

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [busyAction, setBusyAction] = useState<BusyKey>(null);
  const [showHelp, setShowHelp] = useState(false);
  const { refundEscrow } = useWallet();
  // Blocks a second tap from re-entering the refund while one is in flight.
  const cancellingRef = useRef(false);
  // "Add details" notifications deep-link here with ?openEdit=true.
  const autoOpenEditHandledRef = useRef(false);
  // The work review and the rating step both live in PosterReviewModal (the
  // same one the chat uses), which carries the "cannot be undone" step and
  // slide-to-confirm before any release.
  const [showReview, setShowReview] = useState(false);
  const [reviewStartsOnRating, setReviewStartsOnRating] = useState(false);
  const autoOpenReviewHandledRef = useRef(false);

  // Never name the poster as the one who gets paid: the other party is only
  // ever the chosen person, and anything else falls back to a neutral phrase.
  const helperName =
    (otherParty.id && String(otherParty.id) !== String(currentUserId) && otherParty.name) || null;
  const helperLabel = helperName ?? 'the person you chose';

  // ── Has this poster actually been charged? ───────────────────────────────
  // Only asked while the poster can still take the job down (open, nobody
  // chosen). It is the same server read the take-down confirmation uses
  // (readOpenJobMoney → planCancelRefund), so the money sentence, the button
  // label and the confirmation all agree. It reads only.
  // bountyHoldsUnreleasedEscrow is a delete guard that counts every open paid
  // job as held, so it cannot say whether a pay-when-you-choose job has been
  // charged.
  const checksCharge =
    !!bounty &&
    role === 'poster' &&
    canPosterCancelBounty(bounty) &&
    !bounty.is_for_honor &&
    Number(bounty.amount) > 0;
  const [chargeRead, setChargeRead] = useState<OpenJobCharge | null>(null);
  const [chargeReadAttempt, setChargeReadAttempt] = useState(0);
  React.useEffect(() => {
    if (!checksCharge || !bounty) {
      setChargeRead(null);
      return;
    }
    let cancelled = false;
    // Every re-read starts from "Checking…" rather than showing the previous
    // answer as current.
    setChargeRead(null);
    readOpenJobMoney(bounty)
      .then(({ charge }) => {
        if (!cancelled) setChargeRead(charge);
      })
      .catch(() => {
        if (!cancelled) setChargeRead('unknown');
      });
    return () => {
      cancelled = true;
    };
  }, [checksCharge, bounty, chargeReadAttempt]);
  const openJobCharge: OpenJobCharge | null = !checksCharge ? null : chargeRead ?? 'checking';
  const retryChargeRead = useCallback(() => setChargeReadAttempt(n => n + 1), []);

  // ── Finished job: has the poster already left a review? ─────────────────
  // So the page says thank you instead of offering "Leave a review" again
  // (which only answered "Already reviewed"). Unknown (null) keeps the offer.
  const [alreadyRated, setAlreadyRated] = useState<boolean | null>(null);
  React.useEffect(() => {
    const hunterId = bounty?.accepted_by ? String(bounty.accepted_by) : null;
    if (!bounty || role !== 'poster' || bounty.status !== 'completed' || !hunterId || !currentUserId) {
      setAlreadyRated(null);
      return;
    }
    let cancelled = false;
    ratingsService
      .hasRated(String(currentUserId), String(bounty.id), hunterId)
      .then(r => {
        if (!cancelled) setAlreadyRated(!!r);
      })
      .catch(() => {
        if (!cancelled) setAlreadyRated(null);
      });
    return () => {
      cancelled = true;
    };
  }, [bounty, role, currentUserId]);

  // ── What has actually happened (timeline + "last heard from") ────────────
  const [activity, setActivity] = useState<PosterJobActivity>(EMPTY_POSTER_JOB_ACTIVITY);
  React.useEffect(() => {
    if (!bounty || role !== 'poster' || !currentUserId) return;
    let cancelled = false;
    getPosterJobActivity({
      bountyId: String(bounty.id),
      posterId: String(currentUserId),
      helperId: bounty.accepted_by ? String(bounty.accepted_by) : null,
    })
      .then(next => {
        if (!cancelled) setActivity(next);
      })
      .catch(() => {
        if (!cancelled) setActivity(EMPTY_POSTER_JOB_ACTIVITY);
      });
    return () => {
      cancelled = true;
    };
  }, [bounty, role, currentUserId]);

  React.useEffect(() => {
    pushColor(theme.background);
    return () => popColor(theme.background);
  }, [pushColor, popColor, theme.background]);

  // Editing is only honest while the terms can still legally change: open,
  // nobody chosen, and nobody has offered on the current terms yet.
  const canEditTerms =
    !!bounty && bounty.status === 'open' && !bounty.accepted_by && applicationCount === 0;

  const explainEditLocked = useCallback(() => {
    if (!bounty) return;
    const { title, message } = describeEditLocked(bounty, applicationCount, helperName);
    Alert.alert(title, message);
  }, [bounty, applicationCount, helperName]);

  React.useEffect(() => {
    if (openEdit !== 'true' || autoOpenEditHandledRef.current) return;
    if (isLoading || !bounty || role !== 'poster') return;
    autoOpenEditHandledRef.current = true;
    if (canEditTerms) setShowEditModal(true);
    else explainEditLocked();
  }, [openEdit, isLoading, bounty, role, canEditTerms, explainEditLocked]);

  const onRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await refresh();
    } finally {
      setIsRefreshing(false);
    }
  }, [refresh]);

  // Coming back from a chat, a profile, Contact support or the edit screen:
  // re-read quietly so the page never keeps showing the state it had when the
  // poster left. The first focus is the initial load.
  const hasFocusedOnceRef = useRef(false);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useFocusEffect(
    useCallback(() => {
      if (!hasFocusedOnceRef.current) {
        hasFocusedOnceRef.current = true;
        return;
      }
      void refreshRef.current();
    }, [])
  );

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace(bountyAppTabPath('messages', 'myPostings') as never);
  }, [router]);

  // ── Offers on this job ────────────────────────────────────────────────────
  const offersApi = usePosterJobOffers({
    bounty,
    viewerId: currentUserId,
    enabled: !!bounty && role === 'poster' && bounty.status === 'open' && !bounty.accepted_by,
    expectedCount: applicationCount,
    onChanged: refresh,
  });
  const scrollRef = useRef<ScrollView>(null);
  const offersYRef = useRef(0);
  const scrollToOffers = useCallback(() => {
    scrollRef.current?.scrollTo({ y: Math.max(0, offersYRef.current - 12), animated: true });
  }, []);

  // ── After a confirmed hire ────────────────────────────────────────────────
  const [hired, setHired] = useState<{ name: string; hunterId: string | null; conversationId: string | null } | null>(
    null
  );
  const [openingHireChat, setOpeningHireChat] = useState(false);

  // Who is being chosen while the hire is in flight. Between the pay sheet
  // closing and the server's answer there are several seconds (accept, chat
  // set-up, reload) in which the page behind still said "3 people offered";
  // on 16 Nov two senior personas read that as "the hire failed" although both
  // hires had saved. While this is set the page shows one unmistakable
  // "Choosing …" screen instead.
  const [choosingName, setChoosingName] = useState<string | null>(null);
  const chooseOffer = useCallback(
    async (requestId: string | number) => {
      const offer = offersApi.offers.find(o => String(o.id) === String(requestId));
      const name = offer?.profile?.username || 'the person you chose';
      setChoosingName(name);
      let outcome: AcceptRequestOutcome;
      try {
        outcome = await offersApi.choose(requestId);
      } finally {
        setChoosingName(null);
      }
      if (!outcome.accepted) return;
      setHired({
        name: outcome.hunterName || name,
        hunterId: outcome.hunterId,
        conversationId: outcome.conversationId,
      });
      void refresh();
    },
    [offersApi, refresh]
  );

  const openConversationWith = useCallback(
    async (hunterId: string | null, knownConversationId?: string | null) => {
      if (!bounty) return false;
      if (knownConversationId) {
        router.push(`/tabs/messenger/${encodeURIComponent(String(knownConversationId))}` as never);
        return true;
      }
      if (!hunterId) return false;
      const conversation = await messageService.getOrCreateConversation([String(hunterId)], '', String(bounty.id));
      if (!conversation?.id) throw new Error('no conversation');
      router.push(`/tabs/messenger/${encodeURIComponent(String(conversation.id))}` as never);
      return true;
    },
    [bounty, router]
  );

  const messageHiredPerson = useCallback(async () => {
    if (!hired) return;
    setOpeningHireChat(true);
    try {
      await openConversationWith(hired.hunterId, hired.conversationId);
      setHired(null);
    } catch {
      Alert.alert(
        "Couldn't open the conversation",
        `You have still chosen ${hired.name}. Check your connection and try again.`
      );
    } finally {
      setOpeningHireChat(false);
    }
  }, [hired, openConversationWith]);

  // ── Actions ───────────────────────────────────────────────────────────────
  const handleMessage = useCallback(async () => {
    if (!bounty) return;
    const hunterId = otherParty.id ?? (bounty.accepted_by as string | undefined) ?? null;
    if (!hunterId) {
      Alert.alert('Nobody chosen yet', 'You can message the person you choose once you have chosen them.');
      return;
    }
    setBusyAction('message');
    try {
      await openConversationWith(String(hunterId));
    } catch {
      Alert.alert(
        "Couldn't open the conversation",
        'Check your connection and try again. Your messages are safe either way.'
      );
    } finally {
      setBusyAction(null);
    }
  }, [bounty, otherParty.id, openConversationWith]);

  // Approving the work goes through PosterReviewModal's own "cannot be undone"
  // step and slide-to-confirm before approveAndRelease.
  const handleReviewSubmission = useCallback(() => {
    if (!bounty?.accepted_by) {
      Alert.alert('Nothing to check yet', 'Nobody has said this job is done yet.');
      return;
    }
    setReviewStartsOnRating(false);
    setShowReview(true);
  }, [bounty?.accepted_by]);

  // The rating step of the same modal. A poster who already rated this person
  // for this job is told so rather than asked again.
  const handleLeaveReview = useCallback(async () => {
    if (!bounty) return;
    const hunterId = bounty.accepted_by ? String(bounty.accepted_by) : otherParty.id;
    if (!hunterId || !currentUserId) {
      Alert.alert(
        "Couldn't open the review",
        "We couldn't tell who did this job. Pull down to refresh, then try again."
      );
      return;
    }
    setBusyAction('rate');
    let alreadyRated: boolean;
    try {
      alreadyRated = await ratingsService.hasRated(String(currentUserId), String(bounty.id), hunterId);
    } catch {
      Alert.alert("Couldn't open the review", 'Check your connection and try again.');
      return;
    } finally {
      setBusyAction(null);
    }
    if (alreadyRated) {
      Alert.alert('Already reviewed', `You've already left a review for ${helperLabel}. Thank you!`);
      return;
    }
    setReviewStartsOnRating(true);
    setShowReview(true);
  }, [bounty, otherParty.id, currentUserId, helperLabel]);

  const closeReview = useCallback(() => {
    setShowReview(false);
    setReviewStartsOnRating(false);
  }, []);

  const handleSaveEdit = useCallback(
    async (updates: Partial<Bounty>) => {
      if (updates.requirements_payload !== undefined) {
        if (!bounty) throw new Error('No posting selected');
        await saveStructuredBountyEdit(bounty.id, updates);
        setShowEditModal(false);
        await refresh();
        return;
      }
      if (!bounty) return;
      // Someone offering mid-edit must not have the terms changed underneath
      // them, re-checked against the live request rows.
      try {
        const pending = await bountyRequestService.getAll({
          bountyId: String(bounty.id),
          status: 'pending',
        });
        if (pending && pending.length > 0) {
          Alert.alert(
            "Can't change it now",
            'Someone offered to help while you were editing, so the details are locked. Look at their offer instead.'
          );
          return;
        }
      } catch {
        Alert.alert(
          "Can't change it right now",
          "We couldn't check for new offers. Check your connection and try again."
        );
        return;
      }
      await bountyService.update(bounty.id, updates);
      setShowEditModal(false);
      await refresh();
    },
    [bounty, refresh]
  );

  // Taking the job down: the same refund-then-delete path as everywhere else
  // (lib/services/bounty-cancel-refund.ts), confirmed with the amount and
  // where it goes.
  const runCancel = useCallback(
    async (target: Bounty, plan: CancelRefundPlan) => {
      if (cancellingRef.current) return;
      cancellingRef.current = true;
      setBusyAction('delete');
      try {
        const resolvedPlan = await cancelAndRefundBounty(target, { refundEscrow }, plan);
        markBountyRemovedLocally(target.id);
        const doneTitle = resolvedPlan.destination ? 'Job cancelled' : 'Job taken down';
        Alert.alert(doneTitle, describeCancelRefundDone(resolvedPlan), [{ text: 'OK', onPress: goBack }]);
      } catch (err) {
        if (err instanceof BountyRefundFailedError) {
          Alert.alert(
            'Refund failed',
            "We couldn't refund the money held for this job, so it is still live and nothing was lost. Try again, or use Get help with this job."
          );
        } else if (plan.destination) {
          Alert.alert(
            "Couldn't take the job down",
            'Your refund was started, but the job is still listed. Pull down to refresh and try again.'
          );
          void refresh();
        } else {
          const friendly = getUserFriendlyError(err);
          Alert.alert(friendly.title, friendly.message);
        }
      } finally {
        cancellingRef.current = false;
        setBusyAction(null);
      }
    },
    [refundEscrow, goBack, refresh]
  );

  // A quick second tap used to start a second money read and stack a second
  // confirmation behind the first.
  const takeDownCheckRef = useRef(false);
  const handleCancelAndRefund = useCallback(async () => {
    if (!bounty || !canPosterCancelBounty(bounty) || cancellingRef.current || takeDownCheckRef.current) return;
    takeDownCheckRef.current = true;
    setBusyAction('delete');
    // Re-read on every tap: the take-down acts on this fresh plan, never on
    // what the screen showed when it loaded.
    let plan: CancelRefundPlan;
    let charge: OpenJobCharge;
    try {
      ({ plan, charge } = await readOpenJobMoney(bounty));
    } catch {
      setBusyAction(null);
      takeDownCheckRef.current = false;
      Alert.alert(
        "Can't take this job down right now",
        "We couldn't check what's been paid for this job, so nothing was changed. Check your connection and try again."
      );
      return;
    }
    setBusyAction(null);
    takeDownCheckRef.current = false;
    const copy = describeTakeDown(bounty, plan, charge);
    Alert.alert(copy.title, copy.message, [
      { text: 'Keep it', style: 'cancel' },
      { text: copy.confirmLabel, style: 'destructive', onPress: () => void runCancel(bounty, plan) },
    ]);
  }, [bounty, runCancel]);

  const openDispute = useCallback(
    (reason?: string) => {
      if (!routeBountyId) return;
      router.push({
        pathname: '/bounty/[id]/dispute',
        params: reason ? { id: routeBountyId, reason } : { id: routeBountyId },
      } as never);
    },
    [routeBountyId, router]
  );

  const openSupport = useCallback(
    (topic?: 'assist') => {
      if (!bounty || !routeBountyId) return;
      router.push({
        pathname: '/support/contact',
        params: {
          bountyId: routeBountyId,
          bountyTitle: bounty.title ?? '',
          ...(topic ? { topic } : {}),
        },
      } as never);
    },
    [bounty, routeBountyId, router]
  );

  const share = useCallback(() => {
    if (!bounty) return;
    void shareBounty({
      id: bounty.id,
      title: bounty.title,
      amount: bounty.amount,
      isForHonor: bounty.is_for_honor,
      description: bounty.description,
      category: bounty.category,
      location: bounty.location,
    });
  }, [bounty]);

  const viewPayout = useCallback(() => {
    if (!routeBountyId) return;
    router.push({ pathname: '/postings/[bountyId]/payout', params: { bountyId: routeBountyId } } as never);
  }, [routeBountyId, router]);

  const viewProfile = useCallback(() => {
    if (!bounty || !otherParty.id) return;
    router.push(
      `/profile/${otherParty.id}?source=bounty_dashboard&isApplicant=false&bountyId=${encodeURIComponent(
        String(bounty.id)
      )}` as never
    );
  }, [bounty, otherParty.id, router]);

  const onStepAction = useCallback(
    (key: PosterActionKey) => {
      switch (key) {
        case 'choose':
          scrollToOffers();
          return;
        case 'share':
          share();
          return;
        case 'message':
          void handleMessage();
          return;
        case 'check_work':
          handleReviewSubmission();
          return;
        case 'see_report':
          openDispute();
          return;
        case 'answer_cancellation':
          if (routeBountyId)
            router.push({ pathname: '/bounty/[id]/cancellation-response', params: { id: routeBountyId } } as never);
          return;
        case 'report_unresponsive':
          openDispute(bounty?.status === 'in_progress' && state?.status !== 'deadline_passed' ? 'hunter_unresponsive' : 'missed_deadline');
          return;
        case 'rate':
          void handleLeaveReview();
          return;
        case 'post_again':
          router.push(POST_BOUNTY_ROUTE as never);
          return;
        case 'payment_details':
          viewPayout();
          return;
        case 'retry_payment_check':
          retryChargeRead();
          return;
      }
    },
    [
      scrollToOffers,
      share,
      handleMessage,
      handleReviewSubmission,
      openDispute,
      routeBountyId,
      router,
      bounty?.status,
      state?.status,
      handleLeaveReview,
      viewPayout,
      retryChargeRead,
    ]
  );

  const onHelpRoute = useCallback(
    (route: HelpRoute) => {
      setShowHelp(false);
      switch (route) {
        case 'message':
          void handleMessage();
          return;
        case 'no_show':
          openDispute('hunter_unresponsive');
          return;
        case 'missed_time':
          openDispute('missed_deadline');
          return;
        case 'ask_to_finish':
          handleReviewSubmission();
          return;
        case 'work_quality':
          openDispute('work_quality');
          return;
        case 'cancel_open':
          void handleCancelAndRefund();
          return;
        case 'cancel_hired':
          openDispute('other');
          return;
        case 'see_report':
          openDispute();
          return;
        case 'assist':
          openSupport('assist');
          return;
        case 'support':
          openSupport();
          return;
      }
    },
    [handleMessage, openDispute, handleReviewSubmission, handleCancelAndRefund, openSupport]
  );

  // ?openReview=true (rating_reminder) opens the rating step; ?openReview=work
  // (the legacy review screen and payout page now send posters here) opens the
  // work review, so every entry point lands in the same confirmed flow.
  React.useEffect(() => {
    if (!openReview || autoOpenReviewHandledRef.current) return;
    if (isLoading || !bounty || role !== 'poster' || !state) return;
    autoOpenReviewHandledRef.current = true;
    if (openReview === 'work') {
      if (state.status === 'review_needed') handleReviewSubmission();
      return;
    }
    if (openReview !== 'true') return;
    const offersReview =
      state.primaryAction?.key === 'leave_review' || state.secondaryActions.some(a => a.key === 'leave_review');
    if (offersReview) void handleLeaveReview();
  }, [openReview, isLoading, bounty, role, state, handleLeaveReview, handleReviewSubmission]);

  // ── Redirect rather than dead-end a non-poster ────────────────────────────
  React.useEffect(() => {
    if (isAuthLoading || isLoading || !bounty || !routeBountyId) return;
    if (role === 'poster') return;
    if (role === 'hunter') {
      router.replace({ pathname: '/in-progress/[bountyId]/hunter', params: { bountyId: routeBountyId } } as never);
    } else {
      router.replace({ pathname: '/bounty/[id]/public', params: { id: routeBountyId } } as never);
    }
  }, [isAuthLoading, isLoading, bounty, role, routeBountyId, router]);

  // ── States ────────────────────────────────────────────────────────────────
  // The pay sheet takes over the screen while it is open, as in the chat.
  if (offersApi.gate.active) {
    return <AcceptFundingGate gate={offersApi.gate} />;
  }

  // The pay sheet has closed and the hire is being confirmed: say so, full
  // screen, until "You've chosen …" (or the failure alert) replaces it.
  if (choosingName) {
    return (
      <SafeAreaView style={s.centered} testID="poster-choosing">
        <ActivityIndicator size="large" color={theme.primary} />
        <Text style={s.errorTitle} accessibilityRole="header" accessibilityLiveRegion="polite">
          {`Choosing ${choosingName}…`}
        </Text>
        <Text style={s.centeredText}>
          {"This usually takes a few seconds. Please keep the app open. We'll show you when it's done."}
        </Text>
      </SafeAreaView>
    );
  }

  if (isAuthLoading || (isLoading && !bounty)) {
    return <ScreenLoader label="Loading your job…" />;
  }

  if (notFound) {
    return (
      <NotFoundScreen
        title="This job is gone"
        message="It was taken down, or the link points somewhere that no longer exists. Your other jobs are unaffected."
        icon="search-off"
        actionText="Back to my jobs"
        onAction={goBack}
      />
    );
  }

  if (error || !bounty) {
    return (
      <SafeAreaView style={s.centered}>
        <MaterialIcons name="cloud-off" size={48} color={theme.textSecondary} />
        <Text style={s.errorTitle}>{"Couldn't load this job"}</Text>
        <Text style={s.centeredText}>
          {"You're offline or the connection dropped. Nothing about your job has changed."}
        </Text>
        <TouchableOpacity accessibilityRole="button" style={s.retryButton} onPress={onRefresh}>
          <Text style={s.retryButtonText}>Try again</Text>
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" style={s.textButton} onPress={goBack}>
          <Text style={s.textButtonText}>Go back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // Redirect in flight for a non-poster — don't paint a poster's page.
  if (role !== 'poster' || !state) {
    return <ScreenLoader label="Opening the job…" />;
  }

  const amount = Number(bounty.amount) || 0;
  const isForHonor = !!bounty.is_for_honor;
  const isHired = !!bounty.accepted_by;
  const money = derivePosterMoney({ bounty, openJobCharge });
  const step = posterNextStep({
    status: state.status,
    hasDispute,
    hasCancellationRequest,
    posterMustAnswerCancellation: cancellationRequestedByRole === 'hunter',
    offerCount: applicationCount,
    helperName,
    hired: isHired,
    amount,
    isForHonor,
    money,
    reviewDeadline: state.reviewDeadline ?? null,
    hiredAt: activity.hiredAt,
    lastHelperMessageAt: activity.lastHelperMessageAt,
    messagesKnown: activity.messagesKnown,
    alreadyRated: alreadyRated === true,
  });
  const timeline = buildPosterTimeline({
    postedAt: bounty.created_at,
    offers: activity.offers,
    hired: isHired,
    helperName,
    hiredAt: activity.hiredAt,
    fundingMode: bounty.funding_mode,
    amount,
    isForHonor,
    money,
    submission: submission
      ? {
          status: submission.status,
          submitted_at: submission.submitted_at ?? null,
          reviewed_at: (submission as { reviewed_at?: string | null }).reviewed_at ?? null,
        }
      : null,
    hasDispute,
    status: state.status,
  });
  const upcoming = describeUpcoming(step, state.status, isHired);
  const description = bounty.description ?? '';
  const descriptionPreview = description.length > 180 ? `${description.substring(0, 180)}…` : description;
  const categoryLabel = formatCategoryLabel((bounty as any).category);
  const canTakeDown = canPosterCancelBounty(bounty);
  // "Refund" only when money was actually collected.
  const cancelLabel = openJobCharge === 'held' ? 'Cancel and refund' : 'Take this job down';
  const showOffers = bounty.status === 'open' && !isHired;
  const completed = bounty.status === 'completed';
  const paymentStatus = describePaymentStatus(money, helperLabel);

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      <View style={s.header}>
        <TouchableOpacity style={s.headerIcon} onPress={goBack} accessibilityRole="button" accessibilityLabel="Go back">
          <MaterialIcons name="arrow-back" size={26} color={theme.text} />
        </TouchableOpacity>
        <Text style={s.headerTitle} numberOfLines={1} accessibilityRole="header">
          Your job
        </Text>
        <TouchableOpacity
          style={s.headerIcon}
          onPress={share}
          accessibilityRole="button"
          accessibilityLabel="Share this job"
        >
          <MaterialIcons name="share" size={24} color={theme.text} />
        </TouchableOpacity>
      </View>

      <ScrollView
        ref={scrollRef}
        style={s.scroll}
        contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor={theme.text} colors={[theme.primary]} />
        }
      >
        {/* ── What is this, and what is it worth ─────────────────────────── */}
        <View style={s.heroCard}>
          <View style={s.heroTopRow}>
            <Text style={s.heroTitle} numberOfLines={3}>
              {bounty.title}
            </Text>
            {isForHonor ? (
              <View style={s.honorPill}>
                <MaterialIcons name="favorite" size={16} color="#ffffff" />
                <Text style={s.honorPillText}>No payment</Text>
              </View>
            ) : (
              <Text style={s.heroAmount}>{formatDollars(amount)}</Text>
            )}
          </View>
          <View style={s.metaRow}>
            <MetaChip icon="schedule" label={`Posted ${formatAgo(bounty.created_at) ?? 'recently'}`} s={s} color={theme.textSecondary} />
            {!!bounty.end_date && (
              <MetaChip icon="event" label={`Finish by ${formatDate(bounty.end_date)}`} s={s} color={theme.textSecondary} />
            )}
            {!!categoryLabel && <MetaChip icon="local-offer" label={categoryLabel} s={s} color={theme.textSecondary} />}
            {!!bounty.work_type && (
              <MetaChip
                icon={bounty.work_type === 'online' ? 'computer' : 'person-pin'}
                label={bounty.work_type === 'online' ? 'Online' : 'In person'}
                s={s}
                color={theme.textSecondary}
              />
            )}
          </View>
          {bounty.requires_id_verified && (
            <View style={s.metaRow}>
              <MetaChip
                icon="verified-user"
                label={`Only people whose ID Bounty has checked can offer (${getTrustTierLabel(bounty.trust_tier)})`}
                s={s}
                color={theme.primaryLight}
              />
            </View>
          )}
        </View>

        {/* ── Who acts next, what's happening, the one thing to do ──────── */}
        <NextStepCard
          step={step}
          onAction={onStepAction}
          onGetHelp={() => setShowHelp(true)}
          busyKey={busyAction && busyAction !== 'delete' && busyAction !== 'leave_review' ? busyAction : null}
          showPaymentRetry={openJobCharge === 'unknown'}
        />

        {/* ── Everyone who offered, on this job ─────────────────────────── */}
        {showOffers && (
          <View
            onLayout={e => {
              offersYRef.current = e.nativeEvent.layout.y;
            }}
          >
            <JobOffersSection
              offers={offersApi.offers}
              loadState={offersApi.loadState}
              onChoose={chooseOffer}
              onPass={offersApi.pass}
              onAsk={id => void offersApi.ask(id)}
              onRetry={() => void offersApi.reload()}
              askingRequestId={offersApi.askingRequestId}
              isAskBusy={offersApi.isAskBusy}
            />
          </View>
        )}

        {/* ── The person doing it ───────────────────────────────────────── */}
        {isHired && (
          <HelperCard
            name={helperLabel}
            avatar={otherParty.avatar}
            hiredAt={activity.hiredAt}
            lastHelperMessageAt={activity.lastHelperMessageAt}
            messagesKnown={activity.messagesKnown}
            finished={completed}
            onMessage={() => void handleMessage()}
            onViewProfile={otherParty.id ? viewProfile : null}
            isOpeningMessage={busyAction === 'message'}
          />
        )}

        {/* ── What they sent ────────────────────────────────────────────── */}
        {!!submission && (
          <View style={s.card}>
            <View style={s.rowBetween}>
              <Text style={s.sectionTitle}>{`What ${helperLabel} sent`}</Text>
              <Text style={s.mutedSmall}>{submissionStatusLabel(submission.status)}</Text>
            </View>
            {!!submission.message && <Text style={s.cardBody}>{submission.message}</Text>}
            {Array.isArray(submission.proof_items) && submission.proof_items.length > 0 && (
              <View style={s.proofRow}>
                <MaterialIcons name="photo-library" size={20} color={theme.primaryLight} />
                <Text style={s.cardBodyMuted}>
                  {submission.proof_items.length} {submission.proof_items.length === 1 ? 'photo or file' : 'photos or files'}
                </Text>
              </View>
            )}
            {submission.status === 'pending' && (
              <TouchableOpacity
                style={s.outlineBtn}
                onPress={handleReviewSubmission}
                accessibilityRole="button"
                accessibilityLabel="See everything they sent"
              >
                <MaterialIcons name="photo-library" size={20} color={theme.text} />
                <Text style={s.outlineBtnText}>See everything they sent</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* ── History ───────────────────────────────────────────────────── */}
        <JobTimeline events={timeline} upcoming={upcoming} />

        {/* ── Money ─────────────────────────────────────────────────────── */}
        {!isForHonor && amount > 0 && (
          <View style={s.card}>
            <Text style={s.sectionTitle}>Payment</Text>
            <View style={s.rowBetween}>
              <Text style={s.cardBody}>Job price</Text>
              <Text style={s.paymentAmount}>{formatDollars(amount)}</Text>
            </View>
            <View style={s.rowBetween} testID="bounty-payment-state" accessibilityLiveRegion="polite">
              <Text style={s.cardBody}>Status</Text>
              <Text style={s.paymentStatus}>{paymentStatus}</Text>
            </View>
            {completed && (
              <TouchableOpacity
                style={s.linkRow}
                onPress={viewPayout}
                accessibilityRole="button"
                accessibilityLabel="See payment details"
              >
                <Text style={s.linkText}>See payment details</Text>
                <MaterialIcons name="chevron-right" size={22} color={theme.primaryLight} />
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* ── Change or remove the job (open, nobody chosen) ────────────── */}
        {canTakeDown ? (
          <View style={s.card} testID="bounty-manage-actions">
            <Text style={s.sectionTitle}>Change or remove this job</Text>
            <TouchableOpacity
              style={[s.outlineBtn, !canEditTerms && s.dimmedBtn]}
              onPress={canEditTerms ? () => setShowEditModal(true) : explainEditLocked}
              accessibilityRole="button"
              accessibilityLabel="Edit details"
              accessibilityHint={
                canEditTerms ? 'Change the title, description, price or date' : 'Explains why the details are locked'
              }
            >
              <MaterialIcons name={canEditTerms ? 'edit' : 'lock-outline'} size={20} color={theme.text} />
              <Text style={s.outlineBtnText}>Edit details</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.outlineBtn, s.dangerBtn]}
              onPress={() => void handleCancelAndRefund()}
              disabled={busyAction === 'delete'}
              accessibilityRole="button"
              accessibilityLabel={cancelLabel}
              accessibilityState={{ disabled: busyAction === 'delete', busy: busyAction === 'delete' }}
            >
              {busyAction === 'delete' ? (
                <ActivityIndicator size="small" color={theme.errorText} />
              ) : (
                <MaterialIcons name="cancel" size={20} color={theme.errorText} />
              )}
              <Text style={[s.outlineBtnText, { color: theme.errorText }]}>{cancelLabel}</Text>
            </TouchableOpacity>
          </View>
        ) : bounty.status === 'in_progress' || bounty.status === 'cancellation_requested' ? (
          <View style={s.manageNote} testID="bounty-manage-locked">
            <MaterialIcons name="lock-outline" size={20} color={theme.textSecondary} />
            <Text style={s.cardBodyMuted}>
              {`${helperName ?? 'Someone'} is doing this job, so its details can't be changed. If you need to cancel or something is wrong, use Get help with this job.`}
            </Text>
          </View>
        ) : null}

        {/* ── What you asked for ───────────────────────────────────────── */}
        <View style={s.card}>
          <Text style={s.sectionTitle}>What you asked for</Text>
          {description.length > 0 ? (
            <>
              <Text style={s.cardBody}>{descriptionExpanded ? description : descriptionPreview}</Text>
              {description.length > 180 && (
                <TouchableOpacity
                  style={s.expandBtn}
                  onPress={() => setDescriptionExpanded(v => !v)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: descriptionExpanded }}
                >
                  <Text style={s.linkText}>{descriptionExpanded ? 'Show less' : 'Show more'}</Text>
                  <MaterialIcons name={descriptionExpanded ? 'expand-less' : 'expand-more'} size={20} color={theme.primaryLight} />
                </TouchableOpacity>
              )}
            </>
          ) : (
            <Text style={s.cardBodyMuted}>No description was added to this job.</Text>
          )}
          {!!locationText && <DetailRow icon="place" text={locationText} s={s} color={theme.primaryLight} />}
          {!!bounty.timeline && <DetailRow icon="schedule" text={bounty.timeline} s={s} color={theme.primaryLight} />}
          {!!bounty.skills_required && <DetailRow icon="build" text={bounty.skills_required} s={s} color={theme.primaryLight} />}
        </View>
      </ScrollView>

      {showEditModal && (
        <EditPostingModal visible={showEditModal} bounty={bounty} onClose={() => setShowEditModal(false)} onSave={handleSaveEdit} />
      )}

      {isHired && (
        <PosterReviewModal
          visible={showReview}
          bountyId={String(bounty.id)}
          hunterId={String(bounty.accepted_by)}
          hunterName={helperLabel}
          bountyAmount={amount}
          isForHonor={isForHonor}
          architecture={isV3Bounty(bounty as any) ? 'v3' : isPhase2Bounty(bounty as any) ? 'v2' : 'v1'}
          startOnRating={reviewStartsOnRating}
          // Re-read on any close: after a release that didn't confirm, the
          // modal tells the poster to check this page.
          onClose={() => {
            closeReview();
            void refresh();
          }}
          onComplete={() => {
            closeReview();
            void refresh();
          }}
        />
      )}

      <GetHelpSheet
        visible={showHelp}
        onClose={() => setShowHelp(false)}
        onRoute={onHelpRoute}
        helperName={helperName}
        hired={isHired && !completed}
        canTakeDown={canTakeDown}
        awaitingApproval={state.status === 'review_needed'}
        hasDispute={hasDispute && !!disputeId}
        completed={completed}
        moneyLine={step.money}
      />

      <HireConfirmation
        visible={!!hired}
        helperName={hired?.name ?? ''}
        isForHonor={isForHonor}
        onMessage={() => void messageHiredPerson()}
        onDone={() => setHired(null)}
        isOpeningMessage={openingHireChat}
      />
    </SafeAreaView>
  );
}

/** Whether a still-open, unchosen job has charged the poster, per the server. */
type OpenJobCharge = OpenJobChargeState;

/** The Payment card's short status. */
function describePaymentStatus(money: PosterMoneyState, helperLabel: string): string {
  switch (money) {
    case 'checking':
      return 'Checking…';
    case 'unknown':
      return "Couldn't check just now";
    case 'not_charged':
      return 'Not charged yet';
    case 'held':
      return 'Held by Bounty';
    case 'releasing':
      return `On its way to ${helperLabel}`;
    case 'released':
      return `Released to ${helperLabel}`;
    case 'cancelled':
      return 'Job cancelled';
    default:
      return '';
  }
}

/**
 * What to tell the poster about money on an open, unchosen job.
 *
 * `plan` is planCancelRefund's answer, unchanged, and is the only thing a
 * take-down ever acts on. `charge` is for wording only. When
 * fn_get_bounty_funding_requirement can't be read, getBountyFundingRequirement
 * answers "already funded" (so a take-down still tries the refund rather than
 * stranding money), which would make an unpaid pay-when-you-choose job look
 * paid. So for an at_accept job a "held" answer is re-read: a real reply
 * echoes the job's own funding_mode, while that fallback says 'at_post'.
 * Anything not confirmed is 'unknown', never 'held'.
 */
async function readOpenJobMoney(
  bounty: Bounty
): Promise<{ plan: CancelRefundPlan; charge: Exclude<OpenJobCharge, 'checking'> }> {
  const plan = await planCancelRefund(bounty);
  if (!plan.destination || plan.refundAmount <= 0) return { plan, charge: 'not_charged' };
  if (bounty.funding_mode !== 'at_accept') return { plan, charge: 'held' };
  const req = await getBountyFundingRequirement(bounty.id);
  const confirmed = req.fundingMode === 'at_accept' && req.alreadyFunded;
  return { plan, charge: confirmed ? 'held' : 'unknown' };
}

/**
 * The take-down confirmation. "Cancel and refund?" only when the charge is
 * confirmed; otherwise "Take this job down?", matching the button. The plan
 * it confirms, and so what happens, is unchanged either way.
 */
function describeTakeDown(
  bounty: Pick<Bounty, 'is_for_honor'>,
  plan: CancelRefundPlan,
  charge: OpenJobCharge
): { title: string; message: string; confirmLabel: string } {
  const base = describeCancelRefund(bounty, plan);
  const refunds = !!plan.destination && plan.refundAmount > 0;
  if (refunds && charge === 'held') return base;
  if (refunds) {
    const where = plan.destination === 'wallet' ? 'your Bounty balance' : 'your original payment method';
    const amount = `$${plan.refundAmount % 1 === 0 ? plan.refundAmount.toFixed(0) : plan.refundAmount.toFixed(2)}`;
    return {
      title: 'Take this job down?',
      message: `It comes off the app right away, and this can't be undone. We couldn't confirm whether you've been charged for it. If you were, ${amount} goes back to ${where}.`,
      confirmLabel: 'Take it down',
    };
  }
  return { title: 'Take this job down?', message: base.message, confirmLabel: 'Take it down' };
}

/**
 * Why "Edit details" won't open, and what to do instead. People who offered
 * judged the job on its current terms, and a chosen person agreed to them.
 */
function describeEditLocked(
  bounty: Pick<Bounty, 'status'> & { accepted_by?: unknown },
  applicationCount: number,
  helperName: string | null
): { title: string; message: string } {
  if (bounty.status === 'open' && !bounty.accepted_by && applicationCount > 0) {
    const who = applicationCount === 1 ? 'Someone has' : `${applicationCount} people have`;
    return {
      title: 'Details are locked',
      message: `${who} offered to help on these details, so they can't change now. Look at the offers, or take the job down if you no longer need it.`,
    };
  }
  if (bounty.accepted_by || bounty.status === 'in_progress' || bounty.status === 'cancellation_requested') {
    return {
      title: "Can't change this job",
      message: `You've chosen ${helperName ?? 'someone'}, so the details you agreed can't change. Message them, or use Get help with this job if something's wrong.`,
    };
  }
  return { title: "Can't change this job", message: 'This job has ended, so its details are kept as they were.' };
}

type Styles = ReturnType<typeof makeStyles>;

function MetaChip({ icon, label, s, color }: { icon: string; label: string; s: Styles; color: string }) {
  return (
    <View style={s.metaChip}>
      <MaterialIcons name={icon as any} size={16} color={color} />
      <Text style={s.metaChipText}>{label}</Text>
    </View>
  );
}

function DetailRow({ icon, text, s, color }: { icon: string; text: string; s: Styles; color: string }) {
  return (
    <View style={s.detailRow}>
      <MaterialIcons name={icon as any} size={20} color={color} />
      <Text style={s.cardBodyMuted}>{text}</Text>
    </View>
  );
}

function submissionStatusLabel(status: string): string {
  switch (status) {
    case 'pending':
      return 'Waiting for you';
    case 'approved':
      return 'Approved';
    case 'revision_requested':
      return 'You asked for more';
    case 'rejected':
      return 'Not approved';
    default:
      return status;
  }
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return dateString;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
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
    centeredText: { color: t.textSecondary, fontSize: 17, textAlign: 'center', lineHeight: 24 },
    errorTitle: { color: t.text, fontSize: 20, fontWeight: '700' },
    retryButton: {
      backgroundColor: t.primary,
      paddingHorizontal: 28,
      borderRadius: 14,
      marginTop: 8,
      minHeight: 56,
      justifyContent: 'center',
    },
    retryButtonText: { color: t.onPrimary, fontSize: 19, fontWeight: '700' },
    textButton: { paddingHorizontal: 24, minHeight: 48, justifyContent: 'center' },
    textButtonText: { color: t.primaryLight, fontSize: 17, fontWeight: '600' },

    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 8,
      paddingVertical: 6,
      borderBottomWidth: 1,
      borderBottomColor: t.border,
    },
    headerIcon: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
    headerTitle: { flex: 1, color: t.text, fontSize: 19, fontWeight: '700', textAlign: 'center' },

    scroll: { flex: 1 },
    content: { padding: 16 },

    heroCard: {
      backgroundColor: t.surface,
      borderRadius: 18,
      borderWidth: 1,
      ...t.insetBorder,
      padding: 18,
      marginBottom: 16,
      gap: 12,
    },
    heroTopRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
    heroTitle: { flex: 1, color: t.text, fontSize: 22, fontWeight: '800', lineHeight: 28 },
    heroAmount: { color: t.text, fontSize: 26, fontWeight: '800' },
    honorPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: t.primary,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 12,
    },
    honorPillText: { color: '#ffffff', fontSize: 14, fontWeight: '700' },
    metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    metaChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: t.surfaceSecondary,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 10,
      maxWidth: '100%',
    },
    metaChipText: { color: t.textSecondary, fontSize: 15, fontWeight: '600', flexShrink: 1 },

    card: {
      backgroundColor: t.surface,
      borderRadius: 18,
      borderWidth: 1,
      ...t.insetBorder,
      padding: 18,
      marginBottom: 16,
      gap: 12,
    },
    sectionTitle: { color: t.text, fontSize: 20, fontWeight: '800', flexShrink: 1 },
    cardBody: { color: t.text, fontSize: 17, lineHeight: 25 },
    cardBodyMuted: { color: t.textSecondary, fontSize: 16, lineHeight: 23, flex: 1 },
    mutedSmall: { color: t.textSecondary, fontSize: 15 },

    rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    linkRow: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 48 },
    linkText: { color: t.primaryLight, fontSize: 17, fontWeight: '700' },
    expandBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 48 },

    outlineBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.surfaceSecondary,
      paddingHorizontal: 16,
      borderRadius: 14,
      minHeight: 52,
    },
    outlineBtnText: { color: t.text, fontSize: 17, fontWeight: '600' },
    dimmedBtn: { opacity: 0.7 },
    dangerBtn: { borderColor: t.errorText },
    manageNote: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
      padding: 16,
      marginBottom: 16,
      borderRadius: 16,
      backgroundColor: t.surfaceSecondary,
    },

    proofRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    paymentAmount: { color: t.text, fontSize: 20, fontWeight: '800' },
    paymentStatus: { color: t.text, fontSize: 17, fontWeight: '700', flexShrink: 1, textAlign: 'right' },

    detailRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 4 },
  });
}
