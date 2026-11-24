/**
 * The light strip under the featured job: how many other jobs there are,
 * whether any of them needs you, and a Switch button (design F.1 / S.2).
 * Deliberately not a list — other jobs are one tap away, never a dashboard.
 */
import { MaterialIcons } from '@expo/vector-icons'
import * as React from 'react'
import { useMemo } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import type { MyJob } from '../../lib/my-jobs/types'
import { useAppThemeContext } from '../../lib/themes/AppThemeContext'
import type { AppTheme } from '../../lib/themes/types'
import { JobThumb } from './job-bits'

export interface OtherJobsBarProps {
  others: MyJob[]
  /** Pending offers waiting for an answer; counted when there are no other jobs. */
  waitingOffers: number
  onSwitch: () => void
}

/** The line under the count: the most urgent other job, or the all-clear. */
export function otherJobsAttention(others: MyJob[]): { text: string; needsYou: boolean } {
  const needing = others.filter((j) => j.needsYou)
  if (needing.length === 0) return { text: 'Nothing else needs you', needsYou: false }
  if (needing.length === 1) {
    const job = needing[0]
    const text = job.side === 'posted' && job.pendingOfferCount > 0
      ? `Your “${job.title}” job has ${job.pendingOfferCount === 1 ? '1 offer' : `${job.pendingOfferCount} offers`}`
      : job.status.text
    return { text, needsYou: true }
  }
  return { text: `${needing.length} need you`, needsYou: true }
}

export function OtherJobsBar({ others, waitingOffers, onSwitch }: OtherJobsBarProps) {
  const { theme } = useAppThemeContext()
  const s = useMemo(() => makeStyles(theme), [theme])

  const count = others.length
  const heading =
    count > 0
      ? `${count} other ${count === 1 ? 'job' : 'jobs'}`
      : `Your offers · ${waitingOffers} waiting`
  const attention = count > 0 ? otherJobsAttention(others) : { text: 'Waiting for an answer', needsYou: false }

  return (
    <TouchableOpacity
      onPress={onSwitch}
      style={s.bar}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={`${heading}. ${attention.text}. Switch`}
      accessibilityHint="Opens your other jobs"
      testID="other-jobs-bar"
    >
      {count > 0 ? (
        <View style={s.thumbs}>
          {others.slice(0, 3).map((job, i) => (
            <View key={job.key} style={{ marginLeft: i === 0 ? 0 : -14, zIndex: 3 - i }}>
              <JobThumb coverUri={job.coverUri} icon={job.icon} size={38} bordered />
            </View>
          ))}
        </View>
      ) : (
        <View style={s.offerIcon}>
          <MaterialIcons name="send" size={20} color={theme.primaryLight} />
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={s.heading}>{heading}</Text>
        <View style={s.attentionRow}>
          {attention.needsYou ? (
            <MaterialIcons name="notifications-active" size={14} color={theme.warningText} />
          ) : null}
          <Text
            style={[s.attention, attention.needsYou && { color: theme.warningText, fontWeight: '700' }]}
            numberOfLines={2}
          >
            {attention.text}
          </Text>
        </View>
      </View>
      <View style={s.switch}>
        <Text style={s.switchText}>Switch</Text>
        <MaterialIcons name="expand-more" size={20} color={theme.primaryLight} />
      </View>
    </TouchableOpacity>
  )
}

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    bar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: t.surface,
      borderRadius: 18,
      borderWidth: 1,
      ...t.insetBorder,
      paddingHorizontal: 14,
      paddingVertical: 12,
      minHeight: 64,
    },
    thumbs: { flexDirection: 'row', alignItems: 'center' },
    offerIcon: {
      width: 38,
      height: 38,
      borderRadius: 10,
      backgroundColor: t.primaryTint,
      alignItems: 'center',
      justifyContent: 'center',
    },
    heading: { color: t.text, fontSize: 16, fontWeight: '800' },
    attentionRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
    attention: { flex: 1, color: t.textSecondary, fontSize: 14 },
    switch: { flexDirection: 'row', alignItems: 'center', minHeight: 44 },
    switchText: { color: t.primaryLight, fontSize: 16, fontWeight: '800' },
  })
}
