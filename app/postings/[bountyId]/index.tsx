/**
 * app/postings/[bountyId] — the Poster's command center for one bounty.
 *
 * What this replaced, and why:
 *
 * The previous screen tracked a four-stage "timeline" in LOCAL component state
 * seeded from `bounty.status`, let the poster tap through it, and popped a
 * "Stage Locked — complete current stage to unlock" alert when they tapped too
 * far. None of that reflected the backend: the stage reset on every navigation,
 * the "Next Stage" button advanced a bounty whose hunter had submitted nothing,
 * and the screen never once mentioned applications, the selected hunter, the
 * submitted work, or the payment. A poster could not answer "what do I do now?"
 * from it.
 *
 * Everything on this screen is now derived from backend state through
 * useBountyLifecycle → resolveBountyLifecycle: one status, one explanation, one
 * primary action, and the same story the hunter is being told from their side.
 * Secondary and destructive actions live behind the panel's disclosure so the
 * primary action is never one of six equal buttons.
 *
 * Access: a non-poster is no longer met with an "Access Denied" alert that
 * bounced them backwards (a dead end reachable from any deep link) — they are
 * redirected to the view that is actually theirs.
 */
import { MaterialIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
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
import { Image as ExpoImage } from 'expo-image';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { EditPostingModal } from '../../../components/edit-posting-modal';
import { NotFoundScreen } from '../../../components/not-found-screen';
import { BountyStatusPanel } from '../../../components/ui/bounty-status-panel';
import { Stepper } from '../../../components/ui/stepper';
import { useAuthContext } from '../../../hooks/use-auth-context';
import { useBountyLifecycle } from '../../../hooks/useBountyLifecycle';
import { useBackgroundColor } from '../../../lib/context/BackgroundColorContext';
import { ROUTES } from '../../../lib/routes';
import { bountyRequestService } from '../../../lib/services/bounty-request-service';
import { bountyService } from '../../../lib/services/bounty-service';
import type { Bounty } from '../../../lib/services/database.types';
import { messageService } from '../../../lib/services/message-service';
import { useAppThemeContext } from '../../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../../lib/themes/types';
import { getBountyStages } from '../../../lib/utils/bounty-lifecycle';
import type { BountyActionKey } from '../../../lib/utils/bounty-lifecycle';
import { formatCategoryLabel } from '../../../lib/utils/data-utils';
import { bountyHoldsUnreleasedEscrow } from '../../../lib/utils/payment-architecture';
import { shareBounty } from '../../../lib/utils/share-utils';

/** Requests tab inside the Inbox shell — where applications are reviewed. */
const REQUESTS_ROUTE = `${ROUTES.TABS.BOUNTY_APP}?screen=messages&initialTab=requests`;
/** The post-a-bounty flow. */
const POST_BOUNTY_ROUTE = `${ROUTES.TABS.BOUNTY_APP}?screen=postings`;

export default function BountyDashboard() {
  const { bountyId } = useLocalSearchParams<{ bountyId?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // `isAuthLoading` matters here: on a cold start the session restores after
  // the first render, so a poster momentarily looks like a signed-out visitor.
  // Acting on that would redirect them off their own dashboard before auth
  // resolved.
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
    isLoading,
    error,
    notFound,
    refresh,
  } = useBountyLifecycle(routeBountyId, currentUserId);

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [busyAction, setBusyAction] = useState<BountyActionKey | null>(null);

  React.useEffect(() => {
    pushColor(theme.background);
    return () => popColor(theme.background);
  }, [pushColor, popColor, theme.background]);

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
    else router.replace(`${ROUTES.TABS.BOUNTY_APP}?screen=messages&initialTab=myPostings` as never);
  }, [router]);

  // ── Actions ───────────────────────────────────────────────────────────────
  const handleMessage = useCallback(async () => {
    if (!bounty) return;
    const hunterId = otherParty.id ?? (bounty.accepted_by as string | undefined) ?? null;
    if (!hunterId) {
      Alert.alert(
        'No hunter yet',
        'You can message a hunter once you have selected one for this bounty.'
      );
      return;
    }
    setBusyAction('message');
    try {
      const conversation = await messageService.getOrCreateConversation(
        [String(hunterId)],
        '',
        String(bounty.id)
      );
      if (!conversation?.id) throw new Error('no conversation');
      router.push(`/tabs/messenger/${encodeURIComponent(String(conversation.id))}` as never);
    } catch {
      Alert.alert(
        "Couldn't open the conversation",
        'Check your connection and try again. Your messages are safe either way.'
      );
    } finally {
      setBusyAction(null);
    }
  }, [bounty, otherParty.id, router]);

  const handleSaveEdit = useCallback(
    async (updates: Partial<Bounty>) => {
      if (!bounty) return;
      // A hunter applying mid-edit must not have the terms changed underneath
      // them — the same guard the list screens apply, re-checked server-side
      // against the live request rows rather than a stale local count.
      try {
        const pending = await bountyRequestService.getAll({
          bountyId: String(bounty.id),
          status: 'pending',
        });
        if (pending && pending.length > 0) {
          Alert.alert(
            "Can't edit now",
            'A hunter applied while you were editing, so the terms are locked. Review the applications instead.'
          );
          return;
        }
      } catch {
        Alert.alert(
          "Can't edit right now",
          "We couldn't check for new applications. Check your connection and try again."
        );
        return;
      }

      try {
        const updated = await bountyService.update(bounty.id, updates);
        if (!updated) throw new Error('update failed');
        setShowEditModal(false);
        await refresh();
      } catch (err: any) {
        Alert.alert('Changes not saved', err?.message || 'Please try again.');
      }
    },
    [bounty, refresh]
  );

  const handlers = useMemo((): Partial<Record<BountyActionKey, () => void>> => {
    if (!bounty || !routeBountyId) return {};
    const map: Partial<Record<BountyActionKey, () => void>> = {
      message: handleMessage,
      share: () =>
        shareBounty({
          id: bounty.id,
          title: bounty.title,
          amount: bounty.amount,
          isForHonor: bounty.is_for_honor,
          description: bounty.description,
          category: bounty.category,
          location: bounty.location,
        }),
      review_applications: () => router.push(REQUESTS_ROUTE as never),
      review_submission: () =>
        router.push({
          pathname: '/postings/[bountyId]/review-and-verify',
          params: { bountyId: routeBountyId },
        } as never),
      view_payout: () =>
        router.push({
          pathname: '/postings/[bountyId]/payout',
          params: { bountyId: routeBountyId },
        } as never),
      leave_review: () =>
        router.push({
          pathname: '/postings/[bountyId]/payout',
          params: { bountyId: routeBountyId },
        } as never),
      repost: () => router.push(POST_BOUNTY_ROUTE as never),
      cancel_bounty: () =>
        router.push({ pathname: '/bounty/[id]/cancel', params: { id: routeBountyId } } as never),
      respond_cancellation: () =>
        router.push({
          pathname: '/bounty/[id]/cancellation-response',
          params: { id: routeBountyId },
        } as never),
      open_dispute: () =>
        router.push({ pathname: '/bounty/[id]/dispute', params: { id: routeBountyId } } as never),
      view_dispute: () =>
        router.push({ pathname: '/bounty/[id]/dispute', params: { id: routeBountyId } } as never),
      contact_support: () => router.push('/tabs/need-help-screen' as never),
    };

    // Editing is only honest while the terms can still legally change.
    if (bounty.status === 'open' && !bounty.accepted_by && applicationCount === 0) {
      map.edit = () => setShowEditModal(true);
    }
    return map;
  }, [bounty, routeBountyId, applicationCount, handleMessage, router]);

  // ── Redirect rather than dead-end a non-poster ────────────────────────────
  React.useEffect(() => {
    if (isAuthLoading || isLoading || !bounty || !routeBountyId) return;
    if (role === 'poster') return;
    if (role === 'hunter') {
      router.replace({
        pathname: '/in-progress/[bountyId]/hunter',
        params: { bountyId: routeBountyId },
      } as never);
    } else {
      router.replace({
        pathname: '/bounty/[id]/public',
        params: { id: routeBountyId },
      } as never);
    }
  }, [isAuthLoading, isLoading, bounty, role, routeBountyId, router]);

  // ── States ────────────────────────────────────────────────────────────────
  if (isAuthLoading || (isLoading && !bounty)) {
    return (
      <SafeAreaView style={s.centered}>
        <ActivityIndicator size="large" color={theme.primary} />
        <Text style={s.centeredText}>Loading your bounty…</Text>
      </SafeAreaView>
    );
  }

  if (notFound) {
    return (
      <NotFoundScreen
        title="This bounty is gone"
        message="It was deleted, or the link points somewhere that no longer exists. Your other postings are unaffected."
        icon="search-off"
        actionText="Back to My Postings"
        onAction={goBack}
      />
    );
  }

  if (error || !bounty) {
    return (
      <SafeAreaView style={s.centered}>
        <MaterialIcons name="cloud-off" size={48} color={theme.textSecondary} />
        <Text style={s.errorTitle}>{"Couldn't load this bounty"}</Text>
        <Text style={s.centeredText}>
          {"You're offline or the connection dropped. Nothing about the bounty has changed."}
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

  // Redirect in flight for a non-poster — don't paint a poster's dashboard.
  if (role !== 'poster' || !state) {
    return (
      <SafeAreaView style={s.centered}>
        <ActivityIndicator size="large" color={theme.primary} />
        <Text style={s.centeredText}>Opening bounty…</Text>
      </SafeAreaView>
    );
  }

  const stages = getBountyStages('poster');
  const description = bounty.description ?? '';
  const descriptionPreview =
    description.length > 180 ? `${description.substring(0, 180)}…` : description;
  const escrowHeld = bountyHoldsUnreleasedEscrow(bounty as any);
  // formatCategoryLabel returns null for a bounty with no category.
  const categoryLabel = formatCategoryLabel((bounty as any).category);
  const hunterName = otherParty.name || 'your hunter';

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
          Your bounty
        </Text>
        <TouchableOpacity
          style={s.headerIcon}
          onPress={handlers.share}
          accessibilityRole="button"
          accessibilityLabel="Share this bounty"
        >
          <MaterialIcons name="share" size={22} color={theme.text} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={s.scroll}
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
        {/* ── Identity: what is this, and what is it worth ──────────────── */}
        <View style={s.heroCard}>
          <View style={s.heroTopRow}>
            <Text style={s.heroTitle} numberOfLines={3}>
              {bounty.title}
            </Text>
            {bounty.is_for_honor ? (
              <View style={s.honorPill}>
                <MaterialIcons name="favorite" size={14} color="#ffffff" />
                <Text style={s.honorPillText}>For honor</Text>
              </View>
            ) : (
              <Text style={s.heroAmount}>${bounty.amount}</Text>
            )}
          </View>

          <View style={s.metaRow}>
            <MetaChip icon="schedule" label={`Posted ${formatTimeAgo(bounty.created_at)}`} s={s} color={theme.textSecondary} />
            {!!bounty.end_date && (
              <MetaChip icon="event" label={`Due ${formatDate(bounty.end_date)}`} s={s} color={theme.textSecondary} />
            )}
            {!!categoryLabel && (
              <MetaChip icon="local-offer" label={categoryLabel} s={s} color={theme.textSecondary} />
            )}
            {!!bounty.work_type && (
              <MetaChip
                icon={bounty.work_type === 'online' ? 'computer' : 'person-pin'}
                label={bounty.work_type === 'online' ? 'Online' : 'In person'}
                s={s}
                color={theme.textSecondary}
              />
            )}
          </View>
        </View>

        {/* ── The command center: what's happening, what's next, what to do ── */}
        <BountyStatusPanel
          state={state}
          role="poster"
          otherPartyName={otherParty.name}
          onAction={handlers}
          busyAction={busyAction}
        />

        {/* ── Where this bounty is in its life ──────────────────────────── */}
        <View style={s.card}>
          <Text style={s.sectionTitle}>Progress</Text>
          <Stepper stages={stages} activeIndex={state.stageIndex} variant="compact" />
        </View>

        {/* ── Applications ─────────────────────────────────────────────── */}
        {bounty.status === 'open' && (
          <TouchableOpacity
            style={s.card}
            onPress={handlers.review_applications}
            accessibilityRole="button"
            accessibilityLabel={
              applicationCount > 0
                ? `${applicationCount} applications waiting for review`
                : 'No applications yet'
            }
          >
            <View style={s.rowBetween}>
              <View style={s.rowLeft}>
                <MaterialIcons name="people" size={20} color={theme.primaryLight} />
                <Text style={s.sectionTitleInline}>Applications</Text>
              </View>
              {applicationCount > 0 ? (
                <View style={s.countPill}>
                  <Text style={s.countPillText}>{applicationCount}</Text>
                </View>
              ) : (
                <Text style={s.mutedSmall}>None yet</Text>
              )}
            </View>
            <Text style={s.cardBody}>
              {applicationCount > 0
                ? `Review who applied and choose the hunter you want. You're charged only when you accept.`
                : `Hunters who apply show up here. Sharing the bounty gets it in front of more of them.`}
            </Text>
            {applicationCount > 0 && (
              <View style={s.linkRow}>
                <Text style={s.linkText}>Review hunters</Text>
                <MaterialIcons name="chevron-right" size={18} color={theme.primaryLight} />
              </View>
            )}
          </TouchableOpacity>
        )}

        {/* ── The hunter doing the work ─────────────────────────────────── */}
        {!!bounty.accepted_by && (
          <View style={s.card}>
            <Text style={s.sectionTitle}>Your hunter</Text>
            <View style={s.personRow}>
              {otherParty.avatar ? (
                <ExpoImage
                  source={{ uri: otherParty.avatar }}
                  style={s.avatar}
                  recyclingKey={otherParty.avatar}
                  accessibilityLabel={`${hunterName} profile picture`}
                />
              ) : (
                <View style={[s.avatar, s.avatarFallback]}>
                  <MaterialIcons name="person" size={24} color={theme.textSecondary} />
                </View>
              )}
              <View style={s.personText}>
                <Text style={s.personName}>{otherParty.name || 'Hunter'}</Text>
                <Text style={s.mutedSmall}>Selected for this bounty</Text>
              </View>
            </View>
            <View style={s.actionRow}>
              <TouchableOpacity
                style={s.outlineBtn}
                onPress={handleMessage}
                accessibilityRole="button"
                accessibilityLabel={`Message ${hunterName}`}
              >
                <MaterialIcons name="chat" size={16} color={theme.text} />
                <Text style={s.outlineBtnText}>Message</Text>
              </TouchableOpacity>
              {!!otherParty.id && (
                <TouchableOpacity
                  style={s.outlineBtn}
                  onPress={() => router.push(`/profile/${otherParty.id}` as never)}
                  accessibilityRole="button"
                  accessibilityLabel={`View ${hunterName}'s profile`}
                >
                  <MaterialIcons name="badge" size={16} color={theme.text} />
                  <Text style={s.outlineBtnText}>View profile</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}

        {/* ── The submitted work ────────────────────────────────────────── */}
        {!!submission && (
          <View style={s.card}>
            <View style={s.rowBetween}>
              <Text style={s.sectionTitle}>Submitted work</Text>
              <Text style={s.mutedSmall}>{submissionStatusLabel(submission.status)}</Text>
            </View>
            {!!submission.message && <Text style={s.cardBody}>{submission.message}</Text>}
            {Array.isArray(submission.proof_items) && submission.proof_items.length > 0 && (
              <View style={s.proofRow}>
                <MaterialIcons name="attach-file" size={16} color={theme.primaryLight} />
                <Text style={s.mutedSmall}>
                  {submission.proof_items.length}{' '}
                  {submission.proof_items.length === 1 ? 'attachment' : 'attachments'}
                </Text>
              </View>
            )}
            {submission.status === 'pending' && (
              <TouchableOpacity
                style={s.linkRow}
                onPress={handlers.review_submission}
                accessibilityRole="button"
                accessibilityLabel="Open the full review"
              >
                <Text style={s.linkText}>Open the full review</Text>
                <MaterialIcons name="chevron-right" size={18} color={theme.primaryLight} />
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* ── Money: the trust half of the transaction ──────────────────── */}
        {!bounty.is_for_honor && (
          <View style={s.card}>
            <Text style={s.sectionTitle}>Payment</Text>
            <View style={s.rowBetween}>
              <Text style={s.cardBody}>Bounty reward</Text>
              <Text style={s.paymentAmount}>${bounty.amount}</Text>
            </View>
            <View style={s.paymentStateRow}>
              <MaterialIcons
                name={escrowHeld ? 'lock' : bounty.status === 'completed' ? 'check-circle' : 'account-balance-wallet'}
                size={16}
                color={escrowHeld ? theme.warning : theme.success}
              />
              <Text style={s.cardBodyMuted}>
                {escrowHeld
                  ? `Held safely in escrow. It's released to ${hunterName} only when you approve the work.`
                  : bounty.status === 'completed'
                    ? `Released to ${hunterName}.`
                    : "You'll be charged when you accept a hunter, and the money is held in escrow until you approve the work."}
              </Text>
            </View>
          </View>
        )}

        {/* ── The brief itself ──────────────────────────────────────────── */}
        <View style={s.card}>
          <Text style={s.sectionTitle}>Details</Text>
          {description.length > 0 ? (
            <>
              <Text style={s.cardBody}>
                {descriptionExpanded ? description : descriptionPreview}
              </Text>
              {description.length > 180 && (
                <TouchableOpacity
                  style={s.expandBtn}
                  onPress={() => setDescriptionExpanded(v => !v)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: descriptionExpanded }}
                >
                  <Text style={s.linkText}>{descriptionExpanded ? 'Show less' : 'Show more'}</Text>
                  <MaterialIcons
                    name={descriptionExpanded ? 'expand-less' : 'expand-more'}
                    size={16}
                    color={theme.primaryLight}
                  />
                </TouchableOpacity>
              )}
            </>
          ) : (
            <Text style={s.cardBodyMuted}>No description was added to this bounty.</Text>
          )}

          {!!bounty.location && <DetailRow icon="place" text={bounty.location} s={s} color={theme.primaryLight} />}
          {!!bounty.timeline && <DetailRow icon="schedule" text={bounty.timeline} s={s} color={theme.primaryLight} />}
          {!!bounty.skills_required && (
            <DetailRow icon="build" text={bounty.skills_required} s={s} color={theme.primaryLight} />
          )}
        </View>
      </ScrollView>

      {showEditModal && (
        <EditPostingModal
          visible={showEditModal}
          bounty={bounty}
          onClose={() => setShowEditModal(false)}
          onSave={handleSaveEdit}
        />
      )}
    </SafeAreaView>
  );
}

/**
 * Presentational rows. They take the already-memoized style sheet rather than
 * the theme so they never rebuild a StyleSheet per render — the pattern the
 * rest of the hot screens follow.
 */
type Styles = ReturnType<typeof makeStyles>;

function MetaChip({ icon, label, s, color }: { icon: string; label: string; s: Styles; color: string }) {
  return (
    <View style={s.metaChip}>
      <MaterialIcons name={icon as any} size={13} color={color} />
      <Text style={s.metaChipText} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function DetailRow({ icon, text, s, color }: { icon: string; text: string; s: Styles; color: string }) {
  return (
    <View style={s.detailRow}>
      <MaterialIcons name={icon as any} size={16} color={color} />
      <Text style={s.cardBodyMuted}>{text}</Text>
    </View>
  );
}

function submissionStatusLabel(status: string): string {
  switch (status) {
    case 'pending':
      return 'Awaiting your review';
    case 'approved':
      return 'Approved';
    case 'revision_requested':
      return 'Changes requested';
    case 'rejected':
      return 'Rejected';
    default:
      return status;
  }
}

function formatTimeAgo(dateString?: string | null): string {
  if (!dateString) return 'recently';
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return 'recently';
  const diffMs = Date.now() - date.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(diffMs / 3600000);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(diffMs / 86400000);
  return `${days}d ago`;
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
    headerIcon: { padding: 10, minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
    headerTitle: { flex: 1, color: t.text, fontSize: 17, fontWeight: '700' },

    scroll: { flex: 1 },
    content: { padding: 16 },

    heroCard: {
      backgroundColor: t.surface,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: t.border,
      padding: 16,
      marginBottom: 16,
      gap: 12,
    },
    heroTopRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
    heroTitle: { flex: 1, color: t.text, fontSize: 20, fontWeight: '700', lineHeight: 26 },
    heroAmount: { color: t.text, fontSize: 22, fontWeight: '800' },
    honorPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: t.primary,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 12,
    },
    honorPillText: { color: '#ffffff', fontSize: 12, fontWeight: '700' },
    metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    metaChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: t.surfaceSecondary,
      paddingHorizontal: 8,
      paddingVertical: 5,
      borderRadius: 8,
    },
    metaChipText: { color: t.textSecondary, fontSize: 11, fontWeight: '600' },

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
    sectionTitleInline: { color: t.text, fontSize: 15, fontWeight: '700' },
    cardBody: { color: t.text, fontSize: 14, lineHeight: 20 },
    cardBodyMuted: { color: t.textSecondary, fontSize: 13, lineHeight: 19, flex: 1 },
    mutedSmall: { color: t.textSecondary, fontSize: 12 },

    rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    rowLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    countPill: {
      backgroundColor: t.warning,
      minWidth: 24,
      height: 24,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 8,
    },
    countPillText: { color: '#111827', fontSize: 12, fontWeight: '800' },
    linkRow: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44 },
    linkText: { color: t.primaryLight, fontSize: 13, fontWeight: '700' },
    expandBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44 },

    personRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: t.surfaceSecondary },
    avatarFallback: { alignItems: 'center', justifyContent: 'center' },
    personText: { flex: 1 },
    personName: { color: t.text, fontSize: 15, fontWeight: '700' },
    actionRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
    outlineBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.surfaceSecondary,
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 10,
      minHeight: 44,
    },
    outlineBtnText: { color: t.text, fontSize: 13, fontWeight: '600' },

    proofRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    paymentAmount: { color: t.text, fontSize: 18, fontWeight: '800' },
    paymentStateRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },

    detailRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 4 },
  });
}
