/**
 * app/postings/[bountyId] — the poster's workspace for one job (Focus-first
 * handoff screens A–J.4, docs/design/focus-first-poster/).
 *
 * Every stage answers the same four questions — what's happening, what it
 * means, the money truth, what comes after — under the shared workspace
 * header (job, side label for two-sided accounts, five-step bar), and keeps
 * one next step pinned under the thumb. Edit and take-down sit behind "Other
 * options"; after someone is chosen there is no self-cancel, only Help.
 *
 * What the screen says comes from lib/utils/poster-stage-copy.ts, which reads
 * the same resolved lifecycle (useBountyLifecycle → resolveBountyLifecycle)
 * the hunter is reading from their side. Money is only ever described from
 * the server's answer: the charge read for an open job (readOpenJobMoney,
 * the same read the take-down uses), the bounty's escrow state after hiring.
 *
 * Unchanged from the previous screen: the charge read, the edit lock and its
 * explanations, ?openEdit / ?openReview deep links, the refund-then-delete
 * take-down with its double-tap guards, PosterReviewModal for approval and
 * rating, and redirecting anyone who isn't the poster to their own view.
 * Choosing someone (stage D) runs the same accept / reject hooks and pay gate
 * as the job thread.
 */
import { MaterialIcons } from '@expo/vector-icons';
import { saveStructuredBountyEdit } from '../../../lib/services/bounty-requirements-service';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AcceptFundingGate } from '../../../components/accept-funding-gate';
import { EditPostingModal } from '../../../components/edit-posting-modal';
import { NotFoundScreen } from '../../../components/not-found-screen';
import {
  ApplicantProfile,
  FourQuestions,
  HelpSheet,
  NoteBox,
  OtherOptions,
  PeopleStrip,
  PinnedFooter,
  PosterButton,
  ProofPhotos,
  StageFooter,
  StageToast,
  StarRating,
  StorySoFar,
  WorkspaceHeader,
  WorkspaceLayout,
  type OtherOption,
} from '../../../components/poster';
import { useConfirmDialog } from '../../../components/poster/confirm-dialog';
import { PushTransition } from '../../../components/ui/slide-in-screen';
import { PosterReviewModal } from '../../../components/poster-review-modal';
import { ScreenLoader } from '../../../components/ui/screen-loader';
import { useAuthContext } from '../../../hooks/use-auth-context';
import { useApplicationDecisionVisit } from '../../../hooks/useApplicationDecisionVisit';
import { useAcceptFunding } from '../../../hooks/useAcceptFunding';
import { useAcceptRequest } from '../../../hooks/useAcceptRequest';
import { formatExactAddress, useBountyExactLocation } from '../../../hooks/useBountyExactLocation';
import { useBountyLifecycle } from '../../../hooks/useBountyLifecycle';
import { useHireTime, useJobConversation, usePendingApplicants } from '../../../hooks/useJobWorkspaceData';
import { usePayingSlow } from '../../../hooks/usePayingSlow';
import { useUnresolvedDeposit } from '../../../hooks/useUnresolvedDeposit';
import { useRejectRequest } from '../../../hooks/useRejectRequest';
import { useRequestExpiryPolicy } from '../../../hooks/useRequestExpiryPolicy';
import { useBackgroundColor } from '../../../lib/context/BackgroundColorContext';
import { firstName, formatJobAmount, formatJobDay, getBountyCategoryIcon, getBountyCoverUri } from '../../../lib/my-jobs/format';
import { describeTakeDown, readOpenJobMoney } from '../../../lib/my-jobs/take-down';
import { useWorksBothSides } from '../../../lib/my-jobs/side-labels-store';
import type { IconName } from '../../../lib/my-jobs/types';
import { bountyAppTabPath } from '../../../lib/navigation/bounty-app-tab';
import type { BountyRequestWithDetails } from '../../../lib/services/bounty-request-service';
import { bountyRequestService } from '../../../lib/services/bounty-request-service';
import { bountyService } from '../../../lib/services/bounty-service';
import {
  BountyRefundFailedError,
  canPosterCancelBounty,
  cancelAndRefundBounty,
  describeCancelRefundDone,
  type CancelRefundPlan,
} from '../../../lib/services/bounty-cancel-refund';
import type { Bounty } from '../../../lib/services/database.types';
import { trackWorkspacePrimaryTapped } from '../../../lib/services/focus-analytics';
import { ratingsService } from '../../../lib/services/ratings';
import { useAppThemeContext } from '../../../lib/themes/AppThemeContext';
import type { PosterPalette } from '../../../lib/themes/poster-palette';
import { formatCategoryLabel } from '../../../lib/utils/data-utils';
import { getUserFriendlyError } from '../../../lib/utils/error-messages';
import { getHelpOptions, helpSubtitle, type HelpOptionSpec } from '../../../lib/utils/help-options';
import { deriveCoarseVerificationStatus } from '../../../lib/utils/normalize-profile';
import { isPhase2Bounty, isV3Bounty } from '../../../lib/utils/payment-architecture';
import {
  describeApplicant,
  describeApplicantBrief,
  describePosterStage,
  formatClock,
  posterHeaderMeta,
  type OpenJobCharge,
  type PosterActionKey,
} from '../../../lib/utils/poster-stage-copy';
import { formatPublicLocation } from '../../../lib/utils/public-location';
import { markBountyRemovedLocally } from '../../../lib/utils/bounty-visibility';
import { shareBounty } from '../../../lib/utils/share-utils';
import { useWallet } from '../../../lib/wallet-context';

/** My Jobs (the tab that replaced the Inbox). */
const MY_JOBS_ROUTE = bountyAppTabPath('messages', 'myPostings');
/** The post-a-bounty flow. */
const POST_BOUNTY_ROUTE = bountyAppTabPath('postings');
const noop = () => {};

export default function BountyDashboard() {
  const { bountyId, openEdit, openReview, posted, person: personParam } = useLocalSearchParams<{
    bountyId?: string;
    openEdit?: string;
    openReview?: string;
    /** Set by a link straight after publishing: stage A says so. */
    posted?: string;
    /** A request id from "Who offered": opens that person (stage D). */
    person?: string;
  }>();
  const router = useRouter();
  // `isAuthLoading` matters here: on a cold start the session restores after
  // the first render, so a poster momentarily looks like a signed-out visitor.
  // Acting on that would redirect them off their own job before auth resolved.
  const { session, isLoading: isAuthLoading } = useAuthContext();
  const currentUserId = session?.user?.id ?? null;
  const { pushColor, popColor } = useBackgroundColor();
  const { theme } = useAppThemeContext();
  const p = theme.poster;
  const s = useMemo(() => makeStyles(p), [p]);
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
    applicationCount,
    submission,
    hasDispute,
    disputeId,
    dispute,
    cancellation,
    isLoading,
    error,
    notFound,
    refresh,
  } = useBountyLifecycle(routeBountyId, currentUserId);

  // Poster sees their own exact address; bounty.location is only the public label.
  const { exact: exactLocation } = useBountyExactLocation(bounty?.id, role === 'poster');
  const locationText = formatExactAddress(exactLocation) || (bounty ? formatPublicLocation(bounty) : null);

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [busyAction, setBusyAction] = useState<PosterActionKey | 'delete' | 'choose' | 'pass' | null>(null);
  const [toast, setToast] = useState<string | null>(posted === '1' || posted === 'true' ? 'Your job is posted.' : null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [personIndex, setPersonIndex] = useState<number | null>(null);
  const [stars, setStars] = useState(0);
  const [alreadyRated, setAlreadyRated] = useState(false);
  const { ask: askConfirm, dialog: confirmDialog } = useConfirmDialog();
  const { refundEscrow, refreshFromApi } = useWallet();
  // Blocks a second tap from re-entering the refund while one is in flight.
  const cancellingRef = React.useRef(false);
  // "Add details"/"Improve bounty" notifications deep-link here with
  // ?openEdit=true so the poster lands directly in the edit modal. Guarded to
  // fire once per mount — the modal is user-closeable and shouldn't reopen.
  const autoOpenEditHandledRef = React.useRef(false);
  // The completion review and the rating step both live in PosterReviewModal
  // (the same one the chat uses).
  const [showReview, setShowReview] = useState(false);
  const [reviewStartsOnRating, setReviewStartsOnRating] = useState(false);
  // rating_reminder notifications deep-link here with ?openReview=true.
  const autoOpenReviewHandledRef = React.useRef(false);

  // Never name the poster as the one who gets paid: the other party is only
  // ever the hired hunter, and anything else falls back to a neutral phrase.
  const hunterName =
    (otherParty.id && String(otherParty.id) !== String(currentUserId) && otherParty.name) || 'your hunter';
  const helperId = bounty?.accepted_by ? String(bounty.accepted_by) : null;
  const helperName = helperId && otherParty.name && String(otherParty.id) !== String(currentUserId) ? otherParty.name : null;
  const helperFirst = firstName(helperName) ?? 'your helper';
  // For the start of a line: the name as it is, or "Your helper".
  const HelperFirst = helperName ? helperFirst : 'Your helper';

  // ── Records the stage needs beyond the lifecycle ─────────────────────────
  const isPoster = role === 'poster';
  const { applicants, failed: applicantsFailed, ready: applicantsReady, reload: reloadApplicants } = usePendingApplicants(
    bounty?.id != null ? String(bounty.id) : null,
    isPoster && bounty?.status === 'open' && applicationCount > 0
  );
  const hireAt = useHireTime(isPoster && helperId && bounty ? String(bounty.id) : null, helperId);
  const conversation = useJobConversation({
    viewerId: currentUserId,
    otherId: helperId,
    bountyId: bounty?.id ? String(bounty.id) : null,
    enabled: isPoster && !!helperId,
    since: hireAt,
  });
  const refreshWallet = useCallback(async () => {
    if (!session?.access_token) return;
    await refreshFromApi(session.access_token, { silent: true, force: true });
  }, [session?.access_token, refreshFromApi]);
  // E.3: a payment left confirming for this job. Nobody can be chosen until
  // the server says what became of it.
  const { record: unresolvedDeposit, check: checkUnresolvedDeposit, checked: depositChecked } = useUnresolvedDeposit(
    bounty?.id != null ? String(bounty.id) : null,
    isPoster && bounty?.status === 'open',
    (verdict, record) => {
      const name = firstName(record.hunterName) ?? record.hunterName;
      setToast(
        verdict === 'credited'
          ? name === 'this hunter'
            ? 'Your payment is confirmed and in your Bounty balance. You can choose someone now.'
            : `Your payment is confirmed and in your Bounty balance. You can choose ${name} now.`
          : "Your payment didn't go through, and nothing was charged."
      );
      void refreshWallet();
    }
  );
  const shownPerson = personIndex !== null && !unresolvedDeposit ? applicants[personIndex] ?? null : null;
  // "Who offered" links straight to one person.
  const personHandledRef = React.useRef(false);
  React.useEffect(() => {
    if (!personParam || personHandledRef.current || unresolvedDeposit || applicants.length === 0) return;
    personHandledRef.current = true;
    const at = applicants.findIndex((r) => String(r.id) === String(personParam));
    if (at >= 0) setPersonIndex(at);
  }, [personParam, applicants, unresolvedDeposit]);
  // The same application_viewed / application_dismissed the job thread reports.
  const { markEngaged } = useApplicationDecisionVisit({
    request: shownPerson,
    enabled: isPoster && !!shownPerson,
    surface: 'workspace_person',
  });
  const expiryPolicy = useRequestExpiryPolicy();

  // ── Has this poster actually been charged? ───────────────────────────────
  // Only asked while the poster can still take the job down (open, nobody
  // hired). It is the same server read the take-down confirmation uses
  // (readOpenJobMoney → planCancelRefund), so the money line, the button
  // label and the confirmation all agree. It reads only; nothing here moves
  // money.
  const checksCharge =
    !!bounty && isPoster && canPosterCancelBounty(bounty) && !bounty.is_for_honor && Number(bounty.amount) > 0;
  const [chargeRead, setChargeRead] = useState<OpenJobCharge | null>(null);
  // Bumped by "Check again" so a failed read can be retried without knowing
  // about pull-to-refresh.
  const [chargeReadAttempt, setChargeReadAttempt] = useState(0);
  React.useEffect(() => {
    if (!checksCharge || !bounty) {
      setChargeRead(null);
      return;
    }
    let cancelled = false;
    // Every re-read starts from "Checking…" rather than showing the previous
    // answer as current: after a hire elsewhere, "You haven't paid" would be stale.
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
  const retryChargeRead = useCallback(() => setChargeReadAttempt((n) => n + 1), []);

  React.useEffect(() => {
    pushColor(theme.background);
    return () => popColor(theme.background);
  }, [pushColor, popColor, theme.background]);

  // A finished job only asks for a rating the poster hasn't given yet. The
  // stage waits for this answer, so "Send rating" never flashes for a poster
  // who already rated (a failed read counts as an answer: offer the rating).
  const needsRatedCheck = !!bounty && isPoster && bounty.status === 'completed' && !!helperId && !!currentUserId;
  const [ratedCheckedFor, setRatedCheckedFor] = useState<string | null>(null);
  React.useEffect(() => {
    let active = true;
    if (!bounty || !needsRatedCheck || !helperId || !currentUserId) return;
    const id = String(bounty.id);
    ratingsService
      .hasRated(String(currentUserId), id, helperId)
      .then((rated) => {
        if (!active) return;
        setAlreadyRated(!!rated);
        setRatedCheckedFor(id);
      })
      .catch(() => active && setRatedCheckedFor(id));
    return () => {
      active = false;
    };
  }, [bounty, needsRatedCheck, helperId, currentUserId]);
  const ratedReady = !needsRatedCheck || ratedCheckedFor === String(bounty?.id);

  // Editing is only honest while the terms can still legally change: open,
  // nobody hired, and nobody has applied on the current terms yet.
  const canEditTerms = !!bounty && bounty.status === 'open' && !bounty.accepted_by && applicationCount === 0;

  const explainEditLocked = useCallback(() => {
    if (!bounty) return;
    const { title, message } = describeEditLocked(bounty, applicationCount);
    Alert.alert(title, message);
  }, [bounty, applicationCount]);

  // Waits for the bounty so a notification for a bounty that has since been
  // applied to or hired can't open the editor over agreed terms.
  React.useEffect(() => {
    if (openEdit !== 'true' || autoOpenEditHandledRef.current) return;
    if (isLoading || !bounty || role !== 'poster') return;
    autoOpenEditHandledRef.current = true;
    if (canEditTerms) setShowEditModal(true);
    else explainEditLocked();
  }, [openEdit, isLoading, bounty, role, canEditTerms, explainEditLocked]);

  const reloadAll = useCallback(async () => {
    await refresh();
    reloadApplicants();
    conversation.reload();
  }, [refresh, reloadApplicants, conversation]);

  const onRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await reloadAll();
    } finally {
      setIsRefreshing(false);
    }
  }, [reloadAll]);

  // Coming back from a chat, the dispute screen or support: re-read quietly so
  // the page doesn't keep showing the state it had when the poster left. The
  // first focus is the initial load. Read through a ref so a new `refresh`
  // identity (auth restoring) doesn't count as a focus.
  const hasFocusedOnceRef = React.useRef(false);
  const reloadRef = React.useRef(reloadAll);
  reloadRef.current = reloadAll;
  useFocusEffect(
    useCallback(() => {
      if (!hasFocusedOnceRef.current) {
        hasFocusedOnceRef.current = true;
        return;
      }
      void reloadRef.current();
    }, [])
  );

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace(MY_JOBS_ROUTE as never);
  }, [router]);

  // ── Hiring (D → E): the job thread's accept / reject hooks and pay gate ──
  const [localError, setLocalError] = useState<string | null>(null);
  React.useEffect(() => {
    if (!localError) return;
    Alert.alert('Something went wrong', localError);
    setLocalError(null);
  }, [localError]);
  const { gate: acceptFundingGate, ensureFunded, handleAcceptFailure } = useAcceptFunding();
  const reloadForRequests = useCallback(async () => {
    reloadApplicants();
  }, [reloadApplicants]);
  const { handleAcceptRequest } = useAcceptRequest({
    currentUserId: currentUserId ?? undefined,
    bountyRequests: applicants,
    myBounties: bounty ? [bounty] : [],
    setBountyRequests: noop as any,
    setMyBounties: noop as any,
    setInProgressBounties: noop as any,
    setIsLoading: noop as any,
    setError: setLocalError,
    loadMyBounties: refresh,
    loadInProgress: refresh,
    loadRequestsForMyBounties: reloadForRequests,
    setActiveScreen: () => router.replace(MY_JOBS_ROUTE as never),
    ensureFunded,
    refreshWallet,
    handleAcceptFailure,
    showSuccessAlert: false,
  });
  const { handleRejectRequest } = useRejectRequest({
    bountyRequests: applicants,
    setBountyRequests: noop as any,
    setIsLoading: noop as any,
    setError: setLocalError,
  });

  const openThread = useCallback(
    (withId: string | null) => {
      if (!bounty) return;
      const params: Record<string, string> = { bountyId: String(bounty.id), role: 'poster' };
      if (withId) params.with = withId;
      router.push({ pathname: '/tabs/bounty-thread/[bountyId]', params } as never);
    },
    [bounty, router]
  );

  const chooseApplicant = useCallback(
    async (request: BountyRequestWithDetails) => {
      if (!bounty || busyAction) return;
      const hunterId = String((request as any).hunter_id ?? (request as any).user_id ?? '');
      const name = firstName(request.profile?.username) ?? 'They';
      markEngaged('accept');
      setBusyAction('choose');
      try {
        await handleAcceptRequest(request.id);
        // The toast only follows an accept the server actually recorded.
        const fresh = await bountyService.getById(String(bounty.id)).catch(() => null);
        if (fresh && String(fresh.accepted_by ?? '') === hunterId) {
          setPersonIndex(null);
          setToast(`You chose ${name}. ${name} is your helper now.`);
        }
      } finally {
        setBusyAction(null);
        checkUnresolvedDeposit();
        await reloadAll();
      }
    },
    [bounty, busyAction, handleAcceptRequest, reloadAll, markEngaged, checkUnresolvedDeposit]
  );

  const passApplicant = useCallback(
    (request: BountyRequestWithDetails) => {
      const name = firstName(request.profile?.username) ?? 'This person';
      Alert.alert(`Pass on ${name}?`, `${name}'s offer will be declined.`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Pass',
          style: 'destructive',
          onPress: async () => {
            markEngaged('decline');
            setBusyAction('pass');
            try {
              await handleRejectRequest(request.id);
            } finally {
              setBusyAction(null);
              setPersonIndex((i) => (i === null || applicants.length <= 1 ? null : Math.max(0, Math.min(i, applicants.length - 2))));
              await reloadAll();
            }
          },
        },
      ]);
    },
    [handleRejectRequest, applicants.length, reloadAll, markEngaged]
  );

  // ── Review and rating (PosterReviewModal) ────────────────────────────────
  // Approving goes through PosterReviewModal's own "If you approve" step and
  // its "Pay Ada $60?" confirmation before approveAndRelease.
  const handleReviewSubmission = useCallback(() => {
    if (!bounty?.accepted_by) {
      Alert.alert('No hunter yet', 'There is no submitted work to review on this bounty.');
      return;
    }
    setReviewStartsOnRating(false);
    setShowReview(true);
  }, [bounty?.accepted_by]);

  // "Send rating" opens the rating step of the same modal with the stars
  // already chosen. A poster who already rated this helper is told so.
  const handleLeaveReview = useCallback(async () => {
    if (!bounty) return;
    const hunterId = bounty.accepted_by ? String(bounty.accepted_by) : otherParty.id;
    if (!hunterId || !currentUserId) {
      Alert.alert("Couldn't open the review", "We couldn't tell who did this job. Pull down to refresh, then try again.");
      return;
    }
    setBusyAction('send_rating');
    let rated: boolean;
    try {
      rated = await ratingsService.hasRated(String(currentUserId), String(bounty.id), hunterId);
    } catch {
      Alert.alert("Couldn't open the review", 'Check your connection and try again.');
      return;
    } finally {
      setBusyAction(null);
    }
    if (rated) {
      setAlreadyRated(true);
      Alert.alert('Already reviewed', `You've already left a review for ${hunterName}. Thank you!`);
      return;
    }
    setReviewStartsOnRating(true);
    setShowReview(true);
  }, [bounty, otherParty.id, currentUserId, hunterName]);

  const closeReview = useCallback(() => {
    setShowReview(false);
    setReviewStartsOnRating(false);
  }, []);

  // A rating_reminder lands here with ?openReview=true: once the bounty is
  // loaded and rating is actually the thing to do, open the rating step.
  React.useEffect(() => {
    if (openReview !== 'true' || autoOpenReviewHandledRef.current) return;
    if (isLoading || !bounty || role !== 'poster' || !state) return;
    autoOpenReviewHandledRef.current = true;
    const offersReview =
      state.primaryAction?.key === 'leave_review' || state.secondaryActions.some((a) => a.key === 'leave_review');
    if (offersReview) void handleLeaveReview();
  }, [openReview, isLoading, bounty, role, state, handleLeaveReview]);

  // ── Edit ─────────────────────────────────────────────────────────────────
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
      // A hunter applying mid-edit must not have the terms changed underneath
      // them — re-checked against the live request rows, not a stale count.
      try {
        const pending = await bountyRequestService.getAll({ bountyId: String(bounty.id), status: 'pending' });
        if (pending && pending.length > 0) {
          Alert.alert("Can't edit now", 'A hunter applied while you were editing, so the terms are locked. Review the applications instead.');
          return;
        }
      } catch {
        Alert.alert("Can't edit right now", "We couldn't check for new applications. Check your connection and try again.");
        return;
      }
      // A refusal throws a BountyUpdateError whose message says why in plain
      // words; letting it reach the edit modal shows it inline (SBA-10).
      await bountyService.update(bounty.id, updates);
      setShowEditModal(false);
      await refresh();
    },
    [bounty, refresh]
  );

  // ── J.4: take this job down (nobody chosen) ──────────────────────────────
  // The same refund-then-delete path as My Jobs (lib/services/bounty-cancel-refund.ts).
  const runCancel = useCallback(
    async (target: Bounty, plan: CancelRefundPlan) => {
      if (cancellingRef.current) return;
      cancellingRef.current = true;
      setBusyAction('delete');
      try {
        const resolvedPlan = await cancelAndRefundBounty(target, { refundEscrow }, plan);
        markBountyRemovedLocally(target.id);
        const doneTitle = resolvedPlan.destination ? 'Bounty cancelled' : 'Job taken down';
        Alert.alert(doneTitle, describeCancelRefundDone(resolvedPlan), [{ text: 'OK', onPress: goBack }]);
      } catch (err) {
        if (err instanceof BountyRefundFailedError) {
          Alert.alert(
            'Refund failed',
            "We couldn't refund the money held for this bounty, so it is still live and nothing was lost. Try again, or contact support."
          );
        } else if (plan.destination) {
          Alert.alert("Couldn't take the bounty down", 'Your refund went through, but the bounty is still listed. Pull to refresh and try again.');
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

  // A quick second tap must not start a second money read and stack a second
  // confirmation behind the first.
  const takeDownCheckRef = React.useRef(false);
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
    // The confirmation below is modal, so the guard can drop once it shows.
    takeDownCheckRef.current = false;
    const copy = describeTakeDown(bounty, plan, charge);
    askConfirm({ ...copy, onConfirm: () => void runCancel(bounty, plan) });
  }, [bounty, runCancel, askConfirm]);

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

  // ── The stage ────────────────────────────────────────────────────────────
  // Approved and paying: after PAYING_SLOW_AFTER_MS without the job reading
  // back finished, the stage says "We're confirming the payment".
  const payingSlow = usePayingSlow(!!state?.paying, routeBountyId);

  // E2E-01: the stage is shown only once every read it depends on is in: the
  // lifecycle snapshot (job, offers count, submission, helper, dispute,
  // cancellation), the offer list "See each person" opens, whether a payment
  // is still confirming (E.3), and whether this poster already rated. After
  // the first time, refetches keep the stage on screen (the lifecycle refuses
  // backward reads), so the page never drops back to the loader.
  const stageReady =
    !isAuthLoading && !isLoading && !!bounty && !!state && applicantsReady && (!isPoster || depositChecked) && ratedReady;
  const stageShownForRef = React.useRef<string | null>(null);
  if (stageReady && routeBountyId) stageShownForRef.current = routeBountyId;
  const showStage = stageReady || (!!bounty && stageShownForRef.current === routeBountyId);

  const view = useMemo(() => {
    if (!bounty || !state) return null;
    return describePosterStage({
      bounty: bounty as any,
      lifecycle: state,
      helperName,
      applicantCount: applicationCount,
      submission,
      hasDispute,
      disputeOpenedByViewer: dispute?.initiatorId ? String(dispute.initiatorId) === String(currentUserId) : null,
      cancellation: cancellation
        ? {
            requesterType: cancellation.requesterType,
            reason: cancellation.reason,
            refundAmount: cancellation.refundAmount ?? null,
            refundPercentage: cancellation.refundPercentage ?? null,
          }
        : null,
      openJobCharge,
      awaitingReplySince: conversation.awaitingReplySince,
      paymentConfirmingFor: unresolvedDeposit?.hunterName ?? null,
      justPosted: posted === '1' || posted === 'true',
      expiryHours: expiryPolicy.expiryHours,
      canRate: !alreadyRated,
      payingSlow,
    });
  }, [
    bounty,
    state,
    helperName,
    applicationCount,
    submission,
    hasDispute,
    dispute,
    cancellation,
    currentUserId,
    openJobCharge,
    conversation.awaitingReplySince,
    unresolvedDeposit,
    posted,
    expiryPolicy.expiryHours,
    alreadyRated,
    payingSlow,
  ]);

  const handleAction = useCallback(
    async (key: PosterActionKey) => {
      if (!bounty || !routeBountyId || !view) return;
      if (view.primary?.key === key) {
        trackWorkspacePrimaryTapped({ bountyId: routeBountyId, side: 'posted', screenId: view.screenId, action: key });
      }
      switch (key) {
        case 'done':
          // Straight from the composer, "back" would be the composer again.
          if (posted === '1' || posted === 'true') router.replace(MY_JOBS_ROUTE as never);
          else goBack();
          return;
        case 'keep_waiting':
        case 'skip_rating':
        case 'back_to_jobs':
          goBack();
          return;
        case 'add_details':
          if (canEditTerms) setShowEditModal(true);
          else explainEditLocked();
          return;
        case 'see_people':
          setPersonIndex(0);
          return;
        case 'message':
          openThread(helperId);
          return;
        case 'report_no_reply':
          router.push({ pathname: '/bounty/[id]/dispute', params: { id: routeBountyId, reason: 'hunter_unresponsive' } } as never);
          return;
        case 'review_work':
          handleReviewSubmission();
          return;
        case 'send_rating':
          await handleLeaveReview();
          return;
        case 'respond_cancellation':
          router.push({ pathname: '/bounty/[id]/cancellation-response', params: { id: routeBountyId } } as never);
          return;
        case 'see_report':
          if (disputeId) router.push(`/dispute/${disputeId}` as never);
          else router.push({ pathname: '/bounty/[id]/dispute', params: { id: routeBountyId } } as never);
          return;
        case 'repost':
          router.push(POST_BOUNTY_ROUTE as never);
          return;
      }
    },
    [
      bounty,
      routeBountyId,
      view,
      posted,
      goBack,
      canEditTerms,
      explainEditLocked,
      openThread,
      helperId,
      currentUserId,
      handleReviewSubmission,
      handleLeaveReview,
      router,
      disputeId,
    ]
  );

  // The lifecycle's support action: the real support form (not
  // /tabs/need-help-screen, which is the Post-a-Bounty composer), with this
  // job attached. Help's "Talk to a person at Bounty" lands here.
  const lifecycleHandlers = useMemo(
    () => ({
      contact_support: () =>
        router.push({
          pathname: '/support/contact',
          params: { bountyId: routeBountyId, bountyTitle: bounty?.title ?? '' },
        } as never),
    }),
    [router, routeBountyId, bounty?.title]
  );

  const onHelpOption = useCallback(
    (option: HelpOptionSpec) => {
      if (!bounty || !routeBountyId) return;
      setHelpOpen(false);
      switch (option.target) {
        case 'thread':
          openThread(helperId);
          return;
        case 'dispute':
          router.push({ pathname: '/bounty/[id]/dispute', params: { id: routeBountyId, ...(option.reason ? { reason: option.reason } : {}) } } as never);
          return;
        default:
          lifecycleHandlers.contact_support();
      }
    },
    [bounty, routeBountyId, openThread, helperId, router, lifecycleHandlers]
  );

  // ── States ────────────────────────────────────────────────────────────────
  const renderScreen = () => {
  if (isAuthLoading || (isLoading && !bounty)) {
    return <ScreenLoader label="Loading your job…" />;
  }

  if (notFound) {
    return (
      <NotFoundScreen
        title="This bounty is gone"
        message="It was deleted, or the link points somewhere that no longer exists. Your other postings are unaffected."
        icon="search-off"
        actionText="Back to My Jobs"
        onAction={goBack}
      />
    );
  }

  if (error || !bounty) {
    return (
      <SafeAreaView style={s.centered}>
        <NoteBox
          tone="e"
          icon="cloud-off"
          title={"Couldn't load this job"}
          text="You're offline or the connection dropped."
          text2="Nothing about the job has changed."
        />
        <PosterButton label="Try again" icon="refresh" onPress={onRefresh} />
        <PosterButton kind="text" label="Go back" onPress={goBack} />
      </SafeAreaView>
    );
  }

  // Redirect in flight for a non-poster — don't paint a poster's workspace.
  if (role !== 'poster' || !state || !view) {
    return <ScreenLoader label="Opening your job…" />;
  }

  // Still waiting on a read the stage depends on: the same loader, and
  // nothing that offers an action.
  if (!showStage) {
    return <ScreenLoader label="Loading your job…" />;
  }

  const icon = getBountyCategoryIcon(bounty.category) as IconName;
  const coverUri = getBountyCoverUri(bounty.attachments_json);
  const meta = posterHeaderMeta({ bounty: bounty as any, helperName });
  const side = worksBothSides ? 'posted' : null;
  const working = bounty.status === 'in_progress' || bounty.status === 'cancellation_requested';
  const helpOptions = getHelpOptions({
    side: 'posted',
    otherName: helperName ? helperFirst : null,
    working: working && !!helperId,
    workSubmitted: submission?.status === 'pending',
    disputeOpen: hasDispute,
  });
  const heldAmount = bounty.is_for_honor ? null : formatJobAmount(bounty.amount);
  const cancelLabel = openJobCharge === 'held' ? 'Cancel and refund' : 'Take this job down';
  const moreItems: OtherOption[] = canPosterCancelBounty(bounty)
    ? [
        {
          key: 'edit',
          label: 'Edit job details',
          icon: canEditTerms ? 'edit' : 'lock-outline',
          onPress: canEditTerms ? () => setShowEditModal(true) : explainEditLocked,
          disabledReason: canEditTerms ? undefined : 'Explains why the details are locked',
        },
        {
          key: 'take_down',
          label: cancelLabel,
          icon: 'delete-outline',
          danger: true,
          busy: busyAction === 'delete',
          onPress: () => void handleCancelAndRefund(),
        },
      ]
    : [];

  // ── D: one person at a time ──────────────────────────────────────────────
  const person = shownPerson;
  let personScreen: React.ReactNode = null;
  if (person && personIndex !== null) {
    const personView = describeApplicant(person, {
      index: personIndex,
      total: applicants.length,
      verified:
        deriveCoarseVerificationStatus(
          (person.profile as any)?.stripe_identity_status,
          (person.profile as any)?.id_verification_status
        ) === 'verified',
      online: bounty.work_type === 'online',
    });
    const busy = busyAction === 'choose' || busyAction === 'pass';
    personScreen = (
      <WorkspaceLayout
        testID="poster-person-view"
        footer={
          <PinnedFooter>
            <PosterButton
              label={`Choose ${personView.first}`}
              loading={busyAction === 'choose'}
              loadingLabel={`Choosing ${personView.first}`}
              disabled={busy}
              onPress={() => {
                trackWorkspacePrimaryTapped({ bountyId: String(bounty.id), side: 'posted', screenId: 'D', action: 'choose' });
                void chooseApplicant(person);
              }}
              testID="person-choose"
            />
            <PosterButton kind="muted" label="Not this time" disabled={busy} onPress={() => passApplicant(person)} testID="person-pass" />
          </PinnedFooter>
        }
      >
        <WorkspaceHeader
          onBack={() => setPersonIndex(null)}
          backLabel="Your job"
          onHelp={() => setHelpOpen(true)}
          icon={icon}
          coverUri={coverUri}
          title={bounty.title}
          meta={meta}
          side={side}
          step={2}
          stage={personView.stage}
        />
        <PeopleStrip
          label="WHO OFFERED"
          people={applicants.map((r) => ({ key: String(r.id), name: firstName(r.profile?.username) ?? 'Someone', avatarUri: r.profile?.avatar ?? null }))}
          selectedKey={String(person.id)}
          labelOnly={applicants.length === 1}
          onSelect={(chosen) => setPersonIndex(Math.max(0, applicants.findIndex((r) => String(r.id) === chosen.key)))}
        />
        <ApplicantProfile
          name={personView.name}
          avatarUri={person.profile?.avatar ?? null}
          since={personView.since}
          note={personView.note}
          facts={personView.facts.map((f) => ({ icon: f.icon as IconName, text: f.text, muted: f.muted }))}
        />
        {/* Buttons, never a swipe: previous, ask, next. */}
        <View style={s.personNav}>
          <PosterButton
            kind="secondary"
            label={`Ask ${personView.first} a question`}
            onPress={() => {
              markEngaged('message');
              openThread(String((person as any).hunter_id ?? ''));
            }}
            style={s.flex}
            testID="person-ask"
          />
          <PosterButton
            kind="neutral"
            label="Next person"
            trailingIcon="chevron-right"
            disabled={personIndex >= applicants.length - 1}
            onPress={() => setPersonIndex(Math.min(applicants.length - 1, personIndex + 1))}
            style={s.flex}
            testID="person-next"
          />
        </View>
        {personIndex > 0 ? (
          <PosterButton
            kind="text"
            icon="chevron-left"
            label="Previous person"
            onPress={() => setPersonIndex(Math.max(0, personIndex - 1))}
            testID="person-previous"
          />
        ) : null}
        <HelpSheet
          visible={helpOpen}
          onClose={() => setHelpOpen(false)}
          subtitle={null}
          options={helpOptions.map((o) => ({ ...o, icon: o.icon as IconName, onPress: () => onHelpOption(o) }))}
          onTalkToPerson={() => onHelpOption({ key: 'other', icon: 'help-outline', text: '', tone: 'i', target: 'support' })}
        />
      </WorkspaceLayout>
    );
  }

  // ── Every other stage ────────────────────────────────────────────────────
  const proofPhotos = (Array.isArray(submission?.proof_items) ? submission!.proof_items : [])
    .filter((item: any) => item?.type === 'image')
    .map((item: any, i: number) => ({
      key: String(item.id ?? i),
      uri: item.url || item.remoteUri || item.uri || null,
      label: item.name || `Photo ${i + 1}`,
      onPress: handleReviewSubmission,
    }));
  // DESIGN-GAP: bounty_events is admin-only (RLS), so "the story so far" is
  // rebuilt from this job's own timestamps (posted, chosen), not an event log.
  // TODO(E): a participant-readable event log for the full story.
  const story: { when: string; what: string }[] = [];
  const postedDay = formatJobDay(bounty.created_at);
  if (postedDay) story.push({ when: capitalizeDay(postedDay), what: 'You posted the job' });
  const hiredDay = formatJobDay(hireAt);
  if (hiredDay && helperName) {
    story.push({
      when: capitalizeDay(hiredDay),
      what:
        bounty.is_for_honor || bounty.funding_mode === 'at_post'
          ? `You chose ${helperFirst}`
          : `You chose ${helperFirst} and paid ${formatJobAmount(bounty.amount)} into Bounty`,
    });
  }
  const talkDay = formatJobDay(conversation.firstTalk?.at);
  if (talkDay && conversation.firstTalk && helperName) {
    // Not "agreed Saturday": an agreed time isn't stored, only that they wrote.
    story.push({
      when: capitalizeDay(talkDay),
      what: conversation.firstTalk.mine ? `You messaged ${helperFirst}` : `${HelperFirst} messaged you`,
    });
  }
  const lastMessage = conversation.lastFromOther;

  const workspace = (
    <WorkspaceLayout
      refreshing={isRefreshing}
      onRefresh={onRefresh}
      testID="poster-workspace"
      footer={
        <StageFooter
          primary={view.primary}
          secondary={view.secondary}
          onAction={(key) => void handleAction(key)}
          busyKey={busyAction && busyAction !== 'delete' && busyAction !== 'choose' && busyAction !== 'pass' ? busyAction : null}
        />
      }
    >
      <WorkspaceHeader
        onBack={goBack}
        onHelp={() => setHelpOpen(true)}
        icon={icon}
        coverUri={coverUri}
        title={bounty.title}
        meta={meta}
        side={side}
        step={view.step}
        stage={view.stage}
      />
      {toast ? <StageToast text={toast} onHide={() => setToast(null)} /> : null}

      <FourQuestions now={view.now} means={view.means} money={view.money} after={view.after} moneyTestID="bounty-payment-state" />

      {view.show.checkPaymentAgain ? (
        <PosterButton
          kind="text"
          icon="refresh"
          label="Check again"
          accessibilityLabel="Check payment again"
          onPress={retryChargeRead}
          testID="bounty-payment-retry"
        />
      ) : null}

      {applicantsFailed ? (
        <View style={s.applicantError} testID="applicant-load-error">
          <NoteBox
            tone="e"
            icon="wifi-off"
            title="We couldn't refresh the offers"
            text="Your last loaded list is still here. Check your connection and try again."
          />
          <PosterButton kind="text" icon="refresh" label="Try again" onPress={reloadApplicants} />
        </View>
      ) : null}

      {view.show.peopleStrip && applicants.length > 0 ? (
        <PeopleStrip
          label="WHO OFFERED"
          people={applicants.map((r) => ({ key: String(r.id), name: firstName(r.profile?.username) ?? 'Someone', avatarUri: r.profile?.avatar ?? null }))}
          onSelect={(chosen) => setPersonIndex(Math.max(0, applicants.findIndex((r) => String(r.id) === chosen.key)))}
        />
      ) : null}
      {view.show.offersCloseNote ? <Text style={s.smallMuted}>{view.show.offersCloseNote}</Text> : null}

      {view.show.lastMessage && lastMessage ? (
        <NoteBox
          tone="n"
          icon="format-quote"
          title={`${HelperFirst}'s last message · ${[formatJobDay(lastMessage.at), formatClock(lastMessage.at)].filter(Boolean).join(' ')}`}
          text={`“${lastMessage.text}”`}
          testID="last-helper-message"
        />
      ) : null}
      {view.show.story ? <StorySoFar items={story} /> : null}

      {view.screenId === 'H' && submission?.message ? (
        // The helper's own note, as the handoff's review screen (I) shows it.
        <NoteBox tone="n" title={`${HelperFirst}'s note`} text={`“${submission.message}”`} testID="submitted-note" />
      ) : null}
      {view.show.proofPhotos && proofPhotos.length > 0 ? <ProofPhotos items={proofPhotos} cols={3} height={104} /> : null}

      {view.show.rating ? (
        <>
          <Text style={s.h2} accessibilityRole="header">{`How did ${helperFirst} do? (optional)`}</Text>
          <StarRating value={stars} onChange={setStars} />
        </>
      ) : null}

      {moreItems.length > 0 ? (
        <OtherOptions items={moreItems} initiallyOpen={view.moreOpen} testID="bounty-manage-actions" />
      ) : working && helperId ? (
        <Text style={s.smallMuted} testID="bounty-manage-locked">
          {`${HelperFirst} is working on this, so it can't be edited or taken down. If something's wrong, tap Help.`}
        </Text>
      ) : null}

      <JobDetails
        open={detailsOpen}
        onToggle={() => setDetailsOpen((v) => !v)}
        description={bounty.description ?? ''}
        rows={[
          locationText ? { icon: 'place' as IconName, text: locationText } : null,
          bounty.timeline ? { icon: 'schedule' as IconName, text: bounty.timeline } : null,
          bounty.skills_required ? { icon: 'build' as IconName, text: bounty.skills_required } : null,
          formatCategoryLabel((bounty as any).category) ? { icon: 'local-offer' as IconName, text: formatCategoryLabel((bounty as any).category) as string } : null,
          bounty.work_type ? { icon: (bounty.work_type === 'online' ? 'computer' : 'person-pin') as IconName, text: bounty.work_type === 'online' ? 'Online' : 'In person' } : null,
        ].filter((r): r is { icon: IconName; text: string } => !!r)}
        onShare={() =>
          shareBounty({
            id: bounty.id,
            title: bounty.title,
            amount: bounty.amount,
            isForHonor: bounty.is_for_honor,
            description: bounty.description,
            category: bounty.category,
            location: bounty.location,
          })
        }
        palette={p}
      />

      {showEditModal && (
        <EditPostingModal visible={showEditModal} bounty={bounty} onClose={() => setShowEditModal(false)} onSave={handleSaveEdit} />
      )}

      {!!bounty.accepted_by && (
        <PosterReviewModal
          visible={showReview}
          bountyId={String(bounty.id)}
          hunterId={String(bounty.accepted_by)}
          hunterName={hunterName}
          bountyAmount={Number(bounty.amount) || 0}
          isForHonor={!!bounty.is_for_honor}
          architecture={isV3Bounty(bounty as any) ? 'v3' : isPhase2Bounty(bounty as any) ? 'v2' : 'v1'}
          startOnRating={reviewStartsOnRating}
          initialRating={stars || undefined}
          // Re-read on any close: after a release that didn't confirm, the
          // modal tells the poster to check this page.
          onClose={() => {
            closeReview();
            void reloadAll();
          }}
          onComplete={() => {
            closeReview();
            void reloadAll();
          }}
        />
      )}

      <HelpSheet
        visible={helpOpen && !personScreen}
        onClose={() => setHelpOpen(false)}
        subtitle={helpSubtitle({ side: 'posted', otherName: helperName ? helperFirst : null, working: working && !!helperId, heldAmount })}
        options={helpOptions.map((o) => ({ ...o, icon: o.icon as IconName, onPress: () => onHelpOption(o) }))}
        onTalkToPerson={() => onHelpOption({ key: 'other', icon: 'help-outline', text: '', tone: 'i', target: 'support' })}
      />
      {confirmDialog}
    </WorkspaceLayout>
  );
  return <PushTransition base={workspace} top={personScreen} startOpen={!!personParam} slideOut />;
  };

  // The hire step slides in over the screen it came from, which stays mounted
  // underneath. Hosted here, outside renderScreen, so nothing that screen does
  // (a reload, a new stage) can remount the gate mid-payment.
  return (
    <PushTransition
      base={renderScreen()}
      top={
        acceptFundingGate.active ? (
          <AcceptFundingGate
            hostSlides
            gate={acceptFundingGate}
            otherApplicantNames={applicants
              .filter((r) => personIndex === null || r.id !== applicants[personIndex]?.id)
              .map((r) => r.profile?.username ?? '')
              .filter(Boolean)}
            onLeavePending={() => router.replace(MY_JOBS_ROUTE as never)}
            quickConfirm={
              bounty
                ? {
                    jobTitle: bounty.title,
                    jobIcon: getBountyCategoryIcon(bounty.category),
                    sub: shownPerson
                      ? describeApplicantBrief(
                          describeApplicant(shownPerson, { index: 0, total: 1, verified: false, online: bounty.work_type === 'online' })
                        )
                      : null,
                  }
                : undefined
            }
          />
        ) : null
      }
    />
  );
}

/** "today" → "Today", "Monday" stays; for the start of a line. */
function capitalizeDay(day: string): string {
  return day ? day.charAt(0).toUpperCase() + day.slice(1) : day;
}

/** The job's own details, collapsed: description, place, timing, skills, and Share. */
function JobDetails({
  open,
  onToggle,
  description,
  rows,
  onShare,
  palette: p,
}: {
  open: boolean;
  onToggle: () => void;
  description: string;
  rows: { icon: IconName; text: string }[];
  onShare: () => void;
  palette: PosterPalette;
}) {
  const s = useMemo(() => makeStyles(p), [p]);
  return (
    <View style={s.details}>
      <TouchableOpacity
        onPress={onToggle}
        style={s.detailsToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel="Job details"
        testID="job-details-toggle"
      >
        <Text style={s.detailsLabel}>Job details</Text>
        <MaterialIcons name={open ? 'expand-less' : 'expand-more'} size={24} color={p.ink2} />
      </TouchableOpacity>
      {open ? (
        <View style={s.detailsBody}>
          <Text style={description ? s.detailsText : s.detailsMuted}>{description || 'No description was added to this job.'}</Text>
          {rows.map((row) => (
            <View key={row.text} style={s.detailRow}>
              <MaterialIcons name={row.icon} size={18} color={p.gt} />
              <Text style={s.detailsMuted}>{row.text}</Text>
            </View>
          ))}
          <PosterButton kind="text" icon="share" label="Share this job" onPress={onShare} />
        </View>
      ) : null}
    </View>
  );
}

/**
 * Why "Edit job details" won't open, and what to do instead. Applicants judged
 * the job on its current terms, and a hired helper agreed to them, so neither
 * is changed underneath them.
 */
function describeEditLocked(
  bounty: Pick<Bounty, 'status'> & { accepted_by?: unknown },
  applicationCount: number
): { title: string; message: string } {
  if (bounty.status === 'open' && !bounty.accepted_by && applicationCount > 0) {
    const who = applicationCount === 1 ? 'A hunter has' : `${applicationCount} hunters have`;
    return {
      title: 'Details are locked',
      message: `${who} applied on these terms, so they can't change now. Review the applications, or cancel the bounty if you no longer need it.`,
    };
  }
  if (bounty.accepted_by || bounty.status === 'in_progress' || bounty.status === 'cancellation_requested') {
    return {
      title: "Can't edit this bounty",
      message: "A hunter has been hired, so the agreed details can't change. Message them, or use Report a problem if something's wrong.",
    };
  }
  return { title: "Can't edit this bounty", message: 'This bounty has ended, so its details are kept as they were.' };
}

function makeStyles(p: PosterPalette) {
  return StyleSheet.create({
    applicantError: { gap: 8 },
    centered: { flex: 1, backgroundColor: p.bg, justifyContent: 'center', gap: 12, padding: 24 },
    flex: { flex: 1 },
    personNav: { flexDirection: 'row', gap: 10 },
    smallMuted: { color: p.ink2, fontSize: 15, lineHeight: 22 },
    h2: { color: p.ink, fontSize: 20, fontWeight: '800', paddingTop: 4 },
    details: { borderTopWidth: 1, borderBottomWidth: 1, borderColor: p.line },
    detailsToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 56 },
    detailsLabel: { color: p.ink, fontSize: 17, fontWeight: '700' },
    detailsBody: { gap: 8, paddingBottom: 12 },
    detailsText: { color: p.ink, fontSize: 16, lineHeight: 24 },
    detailsMuted: { flex: 1, color: p.ink2, fontSize: 15, lineHeight: 22 },
    detailRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  });
}
