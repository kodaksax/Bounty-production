/**
 * The one job that needs you, as the whole of My Jobs (design F.1 / S.2 /
 * F.end on the poster side, H.4 / H.11 on both).
 *
 * Laid out as the handoff's `feature` block: the job's photo (or its
 * category icon) with what it needs in words on the top-left pill and, for an
 * account that works both sides, which side it is on the bottom-left; then
 * whose job and how much, the title, what just happened, what it means with
 * the money truth, the story so far, and one green next step. Anything else
 * you can do with the job sits behind "Other options".
 */
import { MaterialIcons } from '@expo/vector-icons'
import { Image as ExpoImage } from 'expo-image'
import * as React from 'react'
import { useMemo, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View, type LayoutChangeEvent } from 'react-native'
import { getFeaturedFlag } from '../../lib/my-jobs/format'
import type { ManageAction } from '../../lib/my-jobs/manage-actions'
import type { MyJob } from '../../lib/my-jobs/types'
import { useAppThemeContext } from '../../lib/themes/AppThemeContext'
import { FOCUS, type PosterPalette } from '../../lib/themes/poster-palette'
import type { AppTheme } from '../../lib/themes/types'
import type { BountyLifecycleTone } from '../../lib/utils/bounty-lifecycle'
import { PosterButton } from '../poster/poster-button'
import { SidePill } from '../poster/side-label'
import { ManageActionsList } from './job-bits'

export interface FeaturedJobCardProps {
  job: MyJob
  showSideLabel: boolean
  manageActions: ManageAction[]
  onPrimary: () => void
  onManageAction: (action: ManageAction) => void
  /** Set when the main action goes to messages, so the job's own screen stays one tap away. */
  onOpenJob?: () => void
  /** Photo height; the screen shrinks it so everything below the card fits. */
  heroHeight?: number
  /** Where the card sits in the scroll content. */
  onLayout?: (e: LayoutChangeEvent) => void
  /** Height of everything under the photo, with "Other options" closed. */
  onBodyHeight?: (height: number) => void
}

/** The smallest photo that still fits its pills: one on top, or one on top and one below. */
export function minHeroHeight(showSideLabel: boolean): number {
  return showSideLabel ? 116 : 72
}

export function toneColor(theme: AppTheme, tone: BountyLifecycleTone): string {
  const p = theme.poster
  switch (tone) {
    case 'action':
    case 'positive':
      return p.gt
    case 'warning':
      return p.wt
    case 'neutral':
      return p.ink2
    default:
      return p.ink
  }
}

function flagColor(p: PosterPalette, kind: ReturnType<typeof getFeaturedFlag>['kind']): string {
  switch (kind) {
    case 'attn':
      return p.w
    case 'done':
      return p.g
    case 'help':
      return p.it
    default:
      return p.ink2
  }
}

export function FeaturedJobCard({ job, showSideLabel, manageActions, onPrimary, onManageAction, onOpenJob, heroHeight, onLayout, onBodyHeight }: FeaturedJobCardProps) {
  const { theme } = useAppThemeContext()
  const p = theme.poster
  const s = useMemo(() => makeStyles(theme), [theme])
  const [optionsOpen, setOptionsOpen] = useState(false)
  const statusColor = toneColor(theme, job.status.tone)
  const flag = getFeaturedFlag(job)
  const side = job.side === 'posted' ? 'posted' : job.finished ? 'did' : 'doing'

  return (
    <View style={s.card} onLayout={onLayout} testID="featured-job-card">
      <View style={[s.hero, heroHeight != null && { height: heroHeight }]}>
        {job.coverUri ? (
          <ExpoImage
            source={{ uri: job.coverUri }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            accessibilityLabel={job.side === 'posted' ? 'Your photo of the job' : 'Photo of the job'}
          />
        ) : (
          <MaterialIcons name={job.icon} size={44} color={p.photoInk} />
        )}
        <View style={[s.pill, s.pillTop]} testID="featured-job-flag" accessibilityLabel={flag.text}>
          <MaterialIcons name={flag.icon} size={18} color={flagColor(p, flag.kind)} />
          <Text style={s.pillText}>{flag.text}</Text>
        </View>
        {showSideLabel ? (
          <View style={s.heroSide}>
            <SidePill side={side} size="large" testID={`side-label-${job.side}`} />
          </View>
        ) : null}
      </View>

      <View
        style={s.body}
        onLayout={(e) => {
          // Opening the options should scroll, not squeeze the photo.
          if (!optionsOpen) onBodyHeight?.(e.nativeEvent.layout.height)
        }}
      >
        <Text style={s.kicker} numberOfLines={1}>
          {job.contextLine}
        </Text>
        <Text style={s.title} accessibilityRole="header" numberOfLines={3}>
          {job.title}
        </Text>

        <View style={s.statusRow} testID="featured-job-status">
          <MaterialIcons name={job.status.icon} size={26} color={statusColor} />
          <Text style={[s.status, { color: statusColor }]}>{job.status.text}</Text>
        </View>
        {job.detail ? <Text style={s.detail}>{job.detail}</Text> : null}

        {job.historyLine ? (
          <View style={s.history}>
            <MaterialIcons name="history" size={18} color={p.ink2} />
            <Text style={s.historyText}>{job.historyLine}</Text>
          </View>
        ) : null}

        <TouchableOpacity
          onPress={onPrimary}
          style={s.cta}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={job.cta.label}
          testID="featured-job-cta"
        >
          <Text style={s.ctaText}>{job.cta.label}</Text>
          <MaterialIcons name="arrow-forward" size={26} color={p.onFill} />
        </TouchableOpacity>

        {onOpenJob ? <PosterButton kind="text" label="See the job" onPress={onOpenJob} testID="featured-job-open" /> : null}

        {manageActions.length > 0 ? (
          <View style={s.options}>
            <TouchableOpacity
              onPress={() => setOptionsOpen((v) => !v)}
              style={s.optionsToggle}
              accessibilityRole="button"
              accessibilityState={{ expanded: optionsOpen }}
              accessibilityLabel="Other options"
              testID="featured-job-options"
            >
              <Text style={s.optionsText}>Other options</Text>
              <MaterialIcons name={optionsOpen ? 'expand-less' : 'expand-more'} size={20} color={p.ink2} />
            </TouchableOpacity>
            {optionsOpen ? (
              <ManageActionsList actions={manageActions} onSelect={onManageAction} title={job.title} />
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  )
}

function makeStyles(t: AppTheme) {
  const p = t.poster
  return StyleSheet.create({
    card: {
      backgroundColor: p.card,
      borderRadius: FOCUS.featureRadius,
      overflow: 'hidden',
      ...t.shadows.lg,
    },
    hero: {
      height: FOCUS.featureHero,
      backgroundColor: p.photo,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pill: {
      position: 'absolute',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: p.card,
      borderRadius: 999,
      paddingVertical: 7,
      paddingLeft: 10,
      paddingRight: 13,
      ...t.shadows.sm,
    },
    pillTop: { top: 14, left: 14 },
    pillText: { color: p.ink, fontSize: 15, fontWeight: '800' },
    heroSide: { position: 'absolute', bottom: 14, left: 14 },
    body: { paddingTop: 22, paddingHorizontal: 22, paddingBottom: 24, gap: 10 },
    kicker: { color: p.ink2, fontSize: 15, fontWeight: '700' },
    title: { color: p.ink, fontSize: FOCUS.featureTitle, fontWeight: '800', lineHeight: 30, letterSpacing: -0.3 },
    statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 2 },
    status: { flex: 1, fontSize: FOCUS.featureStatus, fontWeight: '800', lineHeight: 26 },
    detail: { color: p.ink2, fontSize: FOCUS.body, lineHeight: 25 },
    history: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
      borderTopWidth: 1,
      borderTopColor: p.line,
      marginTop: 2,
      paddingTop: 12,
    },
    historyText: { flex: 1, color: p.ink2, fontSize: 15, lineHeight: 22 },
    cta: {
      marginTop: 6,
      minHeight: FOCUS.featureAction,
      borderRadius: 18,
      backgroundColor: p.g,
      paddingHorizontal: 20,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
    },
    ctaText: { flex: 1, color: p.onFill, fontSize: 19, fontWeight: '700' },
    options: { marginTop: 2 },
    optionsToggle: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      minHeight: FOCUS.minTouch,
    },
    optionsText: { color: p.ink2, fontSize: 15, fontWeight: '700' },
  })
}
