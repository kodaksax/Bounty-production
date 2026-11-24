/**
 * The one job that needs you, as the whole of My Jobs (design F.1 / H.4 / H.11).
 *
 * Reads top to bottom as the four questions: whose job and how much, what
 * happened, what it means (with the money truth), and one next step under
 * the thumb. Anything else you can do with the job sits behind "Other options".
 */
import { MaterialIcons } from '@expo/vector-icons'
import { Image as ExpoImage } from 'expo-image'
import * as React from 'react'
import { useMemo, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import type { ManageAction } from '../../lib/my-jobs/manage-actions'
import type { MyJob } from '../../lib/my-jobs/types'
import { useAppThemeContext } from '../../lib/themes/AppThemeContext'
import type { AppTheme } from '../../lib/themes/types'
import type { BountyLifecycleTone } from '../../lib/utils/bounty-lifecycle'
import { JobSideLabel, ManageActionsList, NeedsYouMarker } from './job-bits'

export interface FeaturedJobCardProps {
  job: MyJob
  showSideLabel: boolean
  manageActions: ManageAction[]
  onPrimary: () => void
  onManageAction: (action: ManageAction) => void
}

export function toneColor(theme: AppTheme, tone: BountyLifecycleTone): string {
  switch (tone) {
    case 'action':
    case 'positive':
      return theme.primaryLight
    case 'warning':
      return theme.warningText
    case 'neutral':
      return theme.textSecondary
    default:
      return theme.text
  }
}

export function FeaturedJobCard({ job, showSideLabel, manageActions, onPrimary, onManageAction }: FeaturedJobCardProps) {
  const { theme } = useAppThemeContext()
  const s = useMemo(() => makeStyles(theme), [theme])
  const [optionsOpen, setOptionsOpen] = useState(false)
  const statusColor = toneColor(theme, job.status.tone)

  return (
    <View style={s.card} testID="featured-job-card">
      <View style={s.hero}>
        {job.coverUri ? (
          <ExpoImage
            source={{ uri: job.coverUri }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            accessibilityLabel={job.side === 'posted' ? 'Your photo of the job' : 'Photo of the job'}
          />
        ) : (
          <MaterialIcons name={job.icon} size={44} color={theme.text} style={{ opacity: 0.8 }} />
        )}
        {job.needsYou || job.finished ? (
          <View style={[s.heroPill, s.heroPillTop]}>
            {job.needsYou ? (
              <NeedsYouMarker />
            ) : (
              <View style={s.row}>
                <MaterialIcons name="check-circle" size={16} color={theme.primaryLight} />
                <Text style={[s.heroPillText, { color: theme.primaryLight }]}>Finished</Text>
              </View>
            )}
          </View>
        ) : null}
        {showSideLabel ? (
          <View style={s.heroSide}>
            <JobSideLabel side={job.side} finished={job.finished} />
          </View>
        ) : null}
      </View>

      <View style={s.body}>
        <Text style={s.context} numberOfLines={1}>
          {job.contextLine}
        </Text>
        <Text style={s.title} accessibilityRole="header" numberOfLines={3}>
          {job.title}
        </Text>

        <View style={[s.row, { marginTop: 10 }]} testID="featured-job-status">
          <MaterialIcons name={job.status.icon} size={22} color={statusColor} />
          <Text style={[s.status, { color: statusColor }]}>{job.status.text}</Text>
        </View>
        {job.detail ? <Text style={s.detail}>{job.detail}</Text> : null}

        {job.historyLine ? (
          <View style={s.history}>
            <MaterialIcons name="history" size={16} color={theme.textSecondary} />
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
          <MaterialIcons name="arrow-forward" size={22} color={theme.onPrimary} />
        </TouchableOpacity>

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
              <MaterialIcons name={optionsOpen ? 'expand-less' : 'expand-more'} size={20} color={theme.textSecondary} />
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
  return StyleSheet.create({
    card: {
      backgroundColor: t.surface,
      borderRadius: 24,
      overflow: 'hidden',
      borderWidth: 1,
      ...t.insetBorder,
      ...t.shadows.sm,
    },
    hero: {
      height: 180,
      backgroundColor: t.surfaceSecondary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    heroPill: {
      position: 'absolute',
      backgroundColor: t.surface,
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    heroPillTop: { top: 12, left: 12 },
    heroPillText: { fontSize: 14, fontWeight: '700' },
    heroSide: { position: 'absolute', bottom: 12, left: 12 },
    body: { padding: 20, gap: 4 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    context: { color: t.textSecondary, fontSize: 15, fontWeight: '600' },
    title: { color: t.text, fontSize: 24, fontWeight: '800', lineHeight: 30, marginTop: 2 },
    status: { flex: 1, fontSize: 19, fontWeight: '800' },
    detail: { color: t.textSecondary, fontSize: 16, lineHeight: 23, marginTop: 4 },
    history: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 6,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.border,
      marginTop: 12,
      paddingTop: 12,
    },
    historyText: { flex: 1, color: t.textSecondary, fontSize: 14, lineHeight: 20 },
    cta: {
      marginTop: 16,
      minHeight: 56,
      borderRadius: 16,
      backgroundColor: t.primary,
      paddingHorizontal: 20,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    ctaText: { flex: 1, color: t.onPrimary, fontSize: 18, fontWeight: '800' },
    options: { marginTop: 8 },
    optionsToggle: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      minHeight: 44,
    },
    optionsText: { color: t.textSecondary, fontSize: 15, fontWeight: '700' },
  })
}
