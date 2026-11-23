/**
 * Every job, both sides, one tap away (design S.1).
 *
 * Group headings appear only when the account has jobs on both sides, so a
 * poster-only account sees the same flat list as before. Offers collapse into
 * one "Your offers" row; finished jobs sit in a closed group at the end. Each
 * row's ⋯ opens that job's manage actions in place — no second sheet.
 */
import { MaterialIcons } from '@expo/vector-icons'
import * as React from 'react'
import { useMemo, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import type { ManageAction } from '../../lib/my-jobs/manage-actions'
import { getJobManageActions } from '../../lib/my-jobs/manage-actions'
import type { MyJob } from '../../lib/my-jobs/types'
import { useAppThemeContext } from '../../lib/themes/AppThemeContext'
import { FOCUS } from '../../lib/themes/poster-palette'
import type { AppTheme } from '../../lib/themes/types'
import { PosterButton } from '../poster/poster-button'
import { JobThumb, ManageActionsList, NeedsYouMarker } from './job-bits'
import { MyJobsSheet, SheetSectionLabel } from './my-jobs-sheet'

export interface JobSwitcherSheetProps {
  visible: boolean
  jobs: MyJob[]
  showingKey: string | null
  showGroups: boolean
  waitingOffers: number
  totalOffers: number
  onClose: () => void
  onPick: (job: MyJob) => void
  onOpenOffers: () => void
  onPostJob: () => void
  onManageAction: (action: ManageAction, job: MyJob) => void
}

export function JobSwitcherSheet({
  visible,
  jobs,
  showingKey,
  showGroups,
  waitingOffers,
  totalOffers,
  onClose,
  onPick,
  onOpenOffers,
  onPostJob,
  onManageAction,
}: JobSwitcherSheetProps) {
  const { theme } = useAppThemeContext()
  const s = useMemo(() => makeStyles(theme), [theme])
  const [menuKey, setMenuKey] = useState<string | null>(null)
  const [finishedOpen, setFinishedOpen] = useState(false)

  const live = jobs.filter((j) => !j.finished)
  const posted = live.filter((j) => j.side === 'posted')
  const doing = live.filter((j) => j.side === 'doing')
  const finished = jobs.filter((j) => j.finished)

  const renderRow = (job: MyJob) => {
    const showing = job.key === showingKey
    const actions = getJobManageActions(job)
    const menuOpen = menuKey === job.key
    return (
      <View key={job.key} style={[s.row, showing && s.rowShowing]} testID={`switcher-row-${job.key}`}>
        <View style={s.rowMain}>
          <TouchableOpacity
            style={s.rowTap}
            onPress={() => onPick(job)}
            onLongPress={actions.length > 0 ? () => setMenuKey(job.key) : undefined}
            accessibilityRole="button"
            accessibilityState={{ selected: showing }}
            accessibilityLabel={`${job.title}. ${job.status.text}${job.needsYou ? '. Needs you' : ''}${showing ? '. Showing' : ''}`}
          >
            <JobThumb coverUri={job.coverUri} icon={job.icon} size={50} />
            <View style={{ flex: 1 }}>
              <Text style={s.rowTitle} numberOfLines={2}>
                {job.title}
              </Text>
              <Text style={s.rowStatus} numberOfLines={1}>
                {job.status.text}
              </Text>
              {job.needsYou ? <NeedsYouMarker compact /> : null}
            </View>
            {showing ? (
              <View style={s.showing}>
                <MaterialIcons name="check" size={16} color={theme.primaryLight} />
                <Text style={s.showingText}>Showing</Text>
              </View>
            ) : (
              <MaterialIcons name="chevron-right" size={22} color={theme.textSecondary} />
            )}
          </TouchableOpacity>
          {actions.length > 0 ? (
            <TouchableOpacity
              onPress={() => setMenuKey(menuOpen ? null : job.key)}
              style={s.more}
              accessibilityRole="button"
              accessibilityState={{ expanded: menuOpen }}
              accessibilityLabel={`More options for ${job.title}`}
              testID={`switcher-more-${job.key}`}
            >
              <MaterialIcons name="more-horiz" size={22} color={theme.textSecondary} />
            </TouchableOpacity>
          ) : null}
        </View>
        {menuOpen ? (
          <View style={s.menu}>
            <ManageActionsList
              actions={actions}
              title={job.title}
              onSelect={(action) => {
                setMenuKey(null)
                onManageAction(action, job)
              }}
            />
          </View>
        ) : null}
      </View>
    )
  }

  return (
    <MyJobsSheet visible={visible} title="Your jobs" onClose={onClose} testID="job-switcher-sheet">
      {live.length > 0 ? (
        <Text style={s.hint}>Showing the job that needs you most. Pick another to see it instead.</Text>
      ) : null}

      {showGroups && posted.length > 0 ? <SheetSectionLabel>Jobs you posted</SheetSectionLabel> : null}
      {posted.map(renderRow)}
      {showGroups && doing.length > 0 ? <SheetSectionLabel>{"Work you're doing"}</SheetSectionLabel> : null}
      {doing.map(renderRow)}

      {totalOffers > 0 ? (
        <TouchableOpacity
          onPress={onOpenOffers}
          style={s.offersRow}
          accessibilityRole="button"
          accessibilityLabel={`Your offers, ${waitingOffers} waiting for an answer`}
          testID="switcher-your-offers"
        >
          <MaterialIcons name="send" size={20} color={theme.primaryLight} />
          <Text style={s.offersText}>
            Your offers{waitingOffers > 0 ? ` · ${waitingOffers} waiting for an answer` : ''}
          </Text>
          <MaterialIcons name="chevron-right" size={22} color={theme.primaryLight} />
        </TouchableOpacity>
      ) : null}

      {finished.length > 0 ? (
        <>
          <TouchableOpacity
            onPress={() => setFinishedOpen((v) => !v)}
            style={s.finishedToggle}
            accessibilityRole="button"
            accessibilityState={{ expanded: finishedOpen }}
            accessibilityLabel={`Finished, ${finished.length} ${finished.length === 1 ? 'job' : 'jobs'}`}
            testID="switcher-finished-toggle"
          >
            <SheetSectionLabel>{`Finished (${finished.length})`}</SheetSectionLabel>
            <MaterialIcons name={finishedOpen ? 'expand-less' : 'expand-more'} size={20} color={theme.primaryLight} />
          </TouchableOpacity>
          {finishedOpen ? finished.map(renderRow) : null}
        </>
      ) : null}

      <PosterButton kind="secondary" icon="add" label="Post another job" onPress={onPostJob} testID="switcher-post-job" />
    </MyJobsSheet>
  )
}

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    hint: { color: t.poster.ink2, fontSize: 17, lineHeight: 25 },
    // Handoff block `selrow`: 76pt rows, a 2pt edge, the current job tinted.
    row: {
      borderRadius: 18,
      borderWidth: 2,
      borderColor: t.poster.line,
      backgroundColor: t.poster.card,
    },
    rowShowing: { borderColor: t.poster.g, backgroundColor: t.poster.gtint },
    rowMain: { flexDirection: 'row', alignItems: 'center' },
    rowTap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 10, paddingHorizontal: 14, minHeight: FOCUS.selrowMin },
    rowTitle: { color: t.poster.ink, fontSize: 17, fontWeight: '700', lineHeight: 22 },
    rowStatus: { color: t.poster.ink2, fontSize: 15, marginTop: 3 },
    showing: { flexDirection: 'row', alignItems: 'center', gap: 2 },
    showingText: { color: t.poster.gt, fontSize: 14, fontWeight: '800' },
    more: { width: 44, minHeight: 44, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' },
    menu: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.border,
      paddingHorizontal: 14,
      paddingVertical: 4,
    },
    offersRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      minHeight: 56,
      paddingHorizontal: 14,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: t.border,
      marginTop: 4,
    },
    offersText: { flex: 1, color: t.primaryLight, fontSize: 16, fontWeight: '800' },
    finishedToggle: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44 },
  })
}
