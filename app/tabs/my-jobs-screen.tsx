/**
 * MyJobsScreen — the "My jobs" bottom-nav tab (replaces the Inbox).
 *
 * Shows the one job that needs the user most, whichever side of it they are
 * on, as the whole screen: what happened, what it means, and one next step.
 * Every other job is one tap away in the switcher; offers the user sent sit
 * behind one "Your offers" row; the people who offered on a posted job are in
 * "Who offered". Each job's button opens the screens that already run the
 * work: the job workspace (/postings/[id], /in-progress/[id]/hunter) or the
 * bounty conversation (/tabs/bounty-thread/[id]).
 *
 * This component only composes. Loading lives in hooks/useMyJobsData, the
 * management actions in hooks/useJobManagement, and every rule (which job is
 * featured, what it says, which actions it offers) in lib/my-jobs, where it is
 * unit-tested. The general messenger stays one tap away in the header.
 */
import { MaterialIcons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import * as React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { EditPostingModal } from '../../components/edit-posting-modal'
import { ApplicantsSheet } from '../../components/my-jobs/applicants-sheet'
import { FeaturedJobCard } from '../../components/my-jobs/featured-job-card'
import { JobSwitcherSheet } from '../../components/my-jobs/job-switcher-sheet'
import { MyJobsEmptyState, MyJobsErrorState, NothingNeedsYou } from '../../components/my-jobs/my-jobs-states'
import { OtherJobsBar } from '../../components/my-jobs/other-jobs-bar'
import { YourOffersSheet } from '../../components/my-jobs/your-offers-sheet'
import { OfflineStatusBadge } from '../../components/offline-status-badge'
import { BrandingLogo } from '../../components/ui/branding-logo'
import { PostingsListSkeleton } from '../../components/ui/skeleton-loaders'
import { useFeaturedJobPick } from '../../hooks/useFeaturedJobPick'
import { useJobManagement } from '../../hooks/useJobManagement'
import { useMyJobsData } from '../../hooks/useMyJobsData'
import { useValidUserId } from '../../hooks/useValidUserId'
import { getBottomNavContentPadding } from '../../lib/constants/navigation'
import { groupOffers } from '../../lib/my-jobs/build-my-jobs'
import type { ManualPick } from '../../lib/my-jobs/featured-job'
import {
  bestJobOnSide,
  createManualPick,
  pickFeaturedJob,
  shouldShowSideLabels,
} from '../../lib/my-jobs/featured-job'
import type { ManageAction } from '../../lib/my-jobs/manage-actions'
import { getJobManageActions } from '../../lib/my-jobs/manage-actions'
import type { JobTarget, MyJob, MyOffer } from '../../lib/my-jobs/types'
import { inboxSegmentForLink } from '../../lib/navigation/bounty-app-tab'
import { ROUTES } from '../../lib/routes'
import type { BountyRequestWithDetails } from '../../lib/services/bounty-request-service'
import { useAppThemeContext } from '../../lib/themes/AppThemeContext'
import type { AppTheme } from '../../lib/themes/types'

export interface MyJobsScreenProps {
  /**
   * The Inbox segment a link asked for (`requests`, `myPostings`,
   * `inProgress`, `new`). Kept for every existing link: it now picks which
   * side's job is featured, and `requests` also opens "Who offered".
   */
  initialTab?: string
  /**
   * The job a link is about ("Review hunters", a new-offer notification,
   * /manage?view=applicant). That job is shown, and for `requests` its
   * "Who offered" opens; without one, the most urgent job on the side is used.
   */
  linkBountyId?: string
  /** Kept for the tab shell's contract; My Jobs never reads it. */
  activeScreen?: string
  setActiveScreen: (screen: string) => void
  onBack?: () => void
  onBountyAccepted?: (bountyId?: string | number) => void
  /**
   * False while the tab shell keeps this tab preloaded off-screen. A link's
   * "Who offered" waits until the tab is actually showing.
   */
  isActive?: boolean
}

type OpenSheet = { kind: 'switcher' } | { kind: 'offers'; from?: 'switcher' } | { kind: 'applicants'; bountyId: string } | null

/** Header pulled up under the status bar, like the other tabs. */
const HEADER_TOP_OFFSET = 55

export function MyJobsScreen({ initialTab, linkBountyId, setActiveScreen, isActive = true }: MyJobsScreenProps) {
  const rawUserId = useValidUserId()
  const userId = rawUserId ?? undefined
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { theme } = useAppThemeContext()
  const s = useMemo(() => makeStyles(theme), [theme])
  const [headerHeight, setHeaderHeight] = useState(0)
  const [sheet, setSheet] = useState<OpenSheet>(null)

  const data = useMyJobsData(userId)
  const { jobs, offers, applicantsByBounty, loading, refreshing, error, setError, refresh } = data
  const manage = useJobManagement({ ...data, userId })
  // `pick` is the user's own switcher choice, remembered across launches.
  // `linkPick` is where a link sent them: shown for this visit only, so a
  // notification never overwrites what they chose.
  const { pick, setPick } = useFeaturedJobPick(userId)
  const [linkPick, setLinkPick] = useState<ManualPick | null>(null)

  const featured = useMemo(() => pickFeaturedJob(jobs, linkPick ?? pick), [jobs, linkPick, pick])
  const showingLinkPick = !!linkPick && featured?.reason === 'manual' && featured.job.key === linkPick.key
  const featuredJob = featured?.job ?? null
  const others = useMemo(() => jobs.filter((j) => j.key !== featuredJob?.key), [jobs, featuredJob])
  const offerGroups = useMemo(() => groupOffers(offers), [offers])
  const showSideLabels = useMemo(() => shouldShowSideLabels(jobs, offers), [jobs, offers])
  const allPending = useMemo(() => Array.from(applicantsByBounty.values()).flat(), [applicantsByBounty])

  // ── Navigation ──────────────────────────────────────────────────────────
  const openTarget = React.useCallback(
    (target: JobTarget) => {
      switch (target.kind) {
        case 'applicants':
          setSheet({ kind: 'applicants', bountyId: target.bountyId })
          return
        case 'workspace':
          router.push(
            (target.side === 'posted'
              ? { pathname: '/postings/[bountyId]', params: { bountyId: target.bountyId } }
              : { pathname: '/in-progress/[bountyId]/hunter', params: { bountyId: target.bountyId } }) as never
          )
          return
        case 'thread': {
          const role = target.side === 'posted' ? 'poster' : 'hunter'
          const params: Record<string, string> = { bountyId: target.bountyId, role }
          if (target.withId) params.with = String(target.withId)
          router.push({ pathname: '/tabs/bounty-thread/[bountyId]', params } as never)
          return
        }
      }
    },
    [router]
  )

  const openApplicant = React.useCallback(
    (request: BountyRequestWithDetails) => {
      setSheet(null)
      openTarget({ kind: 'thread', side: 'posted', bountyId: String(request.bounty_id), withId: String(request.hunter_id) })
    },
    [openTarget]
  )

  const postJob = React.useCallback(() => {
    setSheet(null)
    setActiveScreen('postings')
  }, [setActiveScreen])

  const findWork = React.useCallback(() => {
    setSheet(null)
    setActiveScreen('bounty')
  }, [setActiveScreen])

  // ── Switching jobs ──────────────────────────────────────────────────────
  const pickJob = React.useCallback(
    (job: MyJob) => {
      setLinkPick(null)
      setPick(createManualPick(jobs, job.key))
      setSheet(null)
    },
    [jobs, setPick]
  )

  const runManageAction = React.useCallback(
    (action: ManageAction, job: MyJob) => {
      // Close any sheet first so an edit modal or dialog never stacks on it.
      setSheet(null)
      manage.runJobAction(action, job)
    },
    [manage]
  )

  const openOfferJob = React.useCallback(
    (offer: MyOffer) => {
      setSheet(null)
      openTarget({ kind: 'workspace', side: 'doing', bountyId: offer.bountyId })
    },
    [openTarget]
  )

  // ── Links that ask for a side (notifications, "Review hunters", /manage) ──
  const appliedLinkRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    const linkKey = `${initialTab ?? ''}|${linkBountyId ?? ''}`
    if (!initialTab || appliedLinkRef.current === linkKey || loading || !isActive) return
    const side = inboxSegmentForLink(initialTab)
    if (!side) return
    appliedLinkRef.current = linkKey
    const jobSide = side === 'myPostings' ? 'posted' : 'doing'
    // The job the link names, when it names one and it is still on the tab.
    const named = linkBountyId ? jobs.find((j) => j.side === jobSide && j.bountyId === String(linkBountyId)) ?? null : null
    if (jobSide === 'posted') {
      const target =
        named ?? jobs.find((j) => j.side === 'posted' && j.pendingOfferCount > 0) ?? bestJobOnSide(jobs, 'posted')
      if (!target) return
      setLinkPick(createManualPick(jobs, target.key))
      if (initialTab === 'requests' && target.pendingOfferCount > 0) {
        setSheet({ kind: 'applicants', bountyId: target.bountyId })
      }
      return
    }
    const target = named ?? bestJobOnSide(jobs, 'doing')
    if (target) setLinkPick(createManualPick(jobs, target.key))
    else if (offers.length > 0) setSheet({ kind: 'offers' })
  }, [initialTab, linkBountyId, loading, isActive, jobs, offers.length])

  // ── Render ──────────────────────────────────────────────────────────────
  const hasAnything = jobs.length > 0 || offers.length > 0
  const subtitle = !hasAnything
    ? "Tell us what you need done. We'll help you find someone nearby."
    : featured?.reason === 'manual' && !showingLinkPick
      ? 'You picked this job.'
      : featuredJob?.needsYou
        ? "Here's the job that needs you today."
        : 'Nothing needs you right now.'

  const applicantsJob =
    sheet?.kind === 'applicants' ? jobs.find((j) => j.bountyId === sheet.bountyId && j.side === 'posted') ?? null : null

  let body: React.ReactNode
  if (loading && !hasAnything) {
    body = <PostingsListSkeleton count={2} />
  } else if (error && !hasAnything) {
    body = <MyJobsErrorState onRetry={refresh} />
  } else if (!hasAnything) {
    body = <MyJobsEmptyState onPostJob={postJob} onFindWork={findWork} />
  } else {
    body = (
      <>
        {featuredJob ? (
          <FeaturedJobCard
            job={featuredJob}
            showSideLabel={showSideLabels}
            manageActions={getJobManageActions(featuredJob)}
            onPrimary={() => openTarget(featuredJob.cta.target)}
            onManageAction={(action) => runManageAction(action, featuredJob)}
          />
        ) : (
          <NothingNeedsYou
            message={
              offerGroups.waiting.length > 0
                ? "Your offers are waiting for an answer. We'll tell you as soon as someone chooses you."
                : 'Your finished jobs are under Switch.'
            }
          />
        )}
        {others.length > 0 || offers.length > 0 ? (
          <OtherJobsBar
            others={others}
            waitingOffers={offerGroups.waiting.length}
            // With no other job, the bar is the "Your offers" row: open what it names.
            onSwitch={() => setSheet(others.length > 0 ? { kind: 'switcher' } : { kind: 'offers' })}
          />
        ) : null}
        <TouchableOpacity onPress={postJob} style={s.postAnother} accessibilityRole="button" accessibilityLabel="Post another job">
          <MaterialIcons name="add" size={22} color={theme.primaryLight} />
          <Text style={s.postAnotherText}>Post another job</Text>
        </TouchableOpacity>
      </>
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <View
        onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height)}
        style={[s.header, { top: -HEADER_TOP_OFFSET, paddingTop: insets.top }]}
      >
        <View style={s.headerRow}>
          <BrandingLogo size="medium" />
          {/* Every conversation, including ones not tied to a job. */}
          <TouchableOpacity
            style={s.headerIconBtn}
            onPress={() => router.push(ROUTES.TABS.MESSENGER as never)}
            accessibilityRole="button"
            accessibilityLabel={data.totalUnreadMessages > 0 ? `Messages, ${data.totalUnreadMessages} unread` : 'Messages'}
            accessibilityHint="Opens all of your conversations"
            testID="my-jobs-messages"
          >
            <View>
              <MaterialIcons name="chat-bubble-outline" size={22} color={theme.text} />
              {data.totalUnreadMessages > 0 ? (
                <View style={s.headerBadge}>
                  <Text style={s.headerBadgeText}>{data.totalUnreadMessages > 99 ? '99+' : data.totalUnreadMessages}</Text>
                </View>
              ) : null}
            </View>
          </TouchableOpacity>
        </View>
        <View style={{ paddingHorizontal: 16 }}>
          <OfflineStatusBadge />
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[
          s.content,
          {
            paddingTop: Math.max(0, headerHeight - (HEADER_TOP_OFFSET - 12)),
            paddingBottom: getBottomNavContentPadding(insets.bottom, 16),
          },
        ]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={theme.text} colors={[theme.primary]} />
        }
        showsVerticalScrollIndicator={false}
        testID="my-jobs-scroll"
      >
        <Text style={s.title} accessibilityRole="header">
          My Jobs
        </Text>
        <Text style={s.subtitle}>{subtitle}</Text>

        {error && hasAnything ? (
          <View style={s.errorBox} accessibilityRole="alert">
            <Text style={s.errorText}>{error}</Text>
            <TouchableOpacity onPress={() => setError(null)} accessibilityRole="button" accessibilityLabel="Dismiss error" hitSlop={8}>
              <MaterialIcons name="close" size={18} color={theme.errorText} />
            </TouchableOpacity>
          </View>
        ) : null}

        {body}
      </ScrollView>

      <JobSwitcherSheet
        visible={sheet?.kind === 'switcher'}
        jobs={jobs}
        showingKey={featuredJob?.key ?? null}
        showGroups={showSideLabels}
        waitingOffers={offerGroups.waiting.length}
        totalOffers={offers.length}
        onClose={() => setSheet(null)}
        onPick={pickJob}
        onOpenOffers={() => setSheet({ kind: 'offers', from: 'switcher' })}
        onPostJob={postJob}
        onManageAction={runManageAction}
      />
      <YourOffersSheet
        visible={sheet?.kind === 'offers'}
        offers={offers}
        onClose={() => setSheet(null)}
        onBack={sheet?.kind === 'offers' && sheet.from === 'switcher' ? () => setSheet({ kind: 'switcher' }) : undefined}
        onWithdraw={manage.withdrawOffer}
        onOpen={openOfferJob}
        onRemove={manage.removeOffer}
        onFindWork={findWork}
      />
      <ApplicantsSheet
        visible={sheet?.kind === 'applicants' && isActive}
        jobTitle={applicantsJob?.title ?? ''}
        applicants={sheet?.kind === 'applicants' ? applicantsByBounty.get(sheet.bountyId) ?? [] : []}
        allPending={allPending}
        onClose={() => setSheet(null)}
        onOpenPerson={openApplicant}
        onOpenJob={() => {
          if (sheet?.kind !== 'applicants') return
          const bountyId = sheet.bountyId
          setSheet(null)
          openTarget({ kind: 'workspace', side: 'posted', bountyId })
        }}
      />

      {manage.edit.bounty ? (
        <EditPostingModal
          key={manage.edit.bounty.id}
          visible
          bounty={manage.edit.bounty}
          onClose={manage.edit.close}
          onSave={manage.edit.save}
        />
      ) : null}
    </View>
  )
}

export default MyJobsScreen

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    header: {
      position: 'absolute',
      left: 0,
      right: 0,
      backgroundColor: t.background,
      zIndex: 20,
      paddingBottom: 6,
    },
    headerRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 16,
    },
    headerIconBtn: { padding: 8, minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
    headerBadge: {
      position: 'absolute',
      top: -5,
      right: -8,
      minWidth: 16,
      height: 16,
      borderRadius: 8,
      paddingHorizontal: 3,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.error,
    },
    headerBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700', lineHeight: 12 },
    content: { paddingHorizontal: 16, gap: 14 },
    title: { color: t.text, fontSize: 36, fontWeight: '800', letterSpacing: -0.5 },
    subtitle: { color: t.textSecondary, fontSize: 17, lineHeight: 24, marginTop: -8 },
    errorBox: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: t.errorTint,
      borderRadius: 12,
      padding: 12,
    },
    errorText: { flex: 1, color: t.errorText, fontSize: 14 },
    postAnother: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      minHeight: 52,
    },
    postAnotherText: { color: t.primaryLight, fontSize: 17, fontWeight: '800' },
  })
}
