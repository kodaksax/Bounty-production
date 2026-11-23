/**
 * The light strip under the featured job: how many other jobs there are,
 * whether any of them needs you, and a Switch button (design F.1 / S.2 /
 * F.end, handoff block `switch`). Deliberately not a list — other jobs are
 * one tap away, never a dashboard.
 */
import { MaterialIcons } from '@expo/vector-icons'
import * as React from 'react'
import { useMemo } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import type { MyJob } from '../../lib/my-jobs/types'
import { useAppThemeContext } from '../../lib/themes/AppThemeContext'
import { FOCUS, type PosterPalette } from '../../lib/themes/poster-palette'
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
  const p = theme.poster
  const s = useMemo(() => makeStyles(p), [p])

  const count = others.length
  const attention = count > 0 ? otherJobsAttention(others) : { text: 'Waiting for an answer', needsYou: false }
  // F.end: "2 other jobs · nothing needs you", with no second line.
  const heading =
    count > 0
      ? `${count} other ${count === 1 ? 'job' : 'jobs'}${attention.needsYou ? '' : ' · nothing needs you'}`
      : `Your offers · ${waitingOffers} waiting`
  const line = count > 0 ? (attention.needsYou ? attention.text : null) : attention.text

  return (
    <TouchableOpacity
      onPress={onSwitch}
      style={s.bar}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={`${heading}${line ? `. ${line}` : ''}. Switch`}
      accessibilityHint="Opens your other jobs"
      testID="other-jobs-bar"
    >
      {count > 0 ? (
        <View style={s.thumbs}>
          {others.slice(0, 3).map((job, i) => (
            <View key={job.key} style={{ marginLeft: i === 0 ? 0 : -10, zIndex: 3 - i }}>
              <JobThumb coverUri={job.coverUri} icon={job.icon} size={36} bordered />
            </View>
          ))}
        </View>
      ) : (
        <View style={s.offerIcon}>
          <MaterialIcons name="send" size={20} color={p.gt} />
        </View>
      )}
      <View style={s.text}>
        <Text style={s.heading}>{heading}</Text>
        {line ? (
          <View style={s.attentionRow}>
            {attention.needsYou ? <MaterialIcons name="notifications-active" size={16} color={p.wt} /> : null}
            <Text style={[s.attention, attention.needsYou && s.attentionUrgent]} numberOfLines={2}>
              {line}
            </Text>
          </View>
        ) : null}
      </View>
      <View style={s.switch}>
        <Text style={s.switchText}>Switch</Text>
        <MaterialIcons name="expand-more" size={24} color={p.gt} />
      </View>
    </TouchableOpacity>
  )
}

function makeStyles(p: PosterPalette) {
  return StyleSheet.create({
    bar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      backgroundColor: p.card,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: p.line,
      paddingLeft: 22,
      paddingRight: 14,
      paddingVertical: 10,
      minHeight: FOCUS.switchMin,
    },
    thumbs: { flexDirection: 'row', alignItems: 'center' },
    offerIcon: {
      width: 36,
      height: 36,
      borderRadius: 11,
      backgroundColor: p.gtint,
      alignItems: 'center',
      justifyContent: 'center',
    },
    text: { flex: 1, gap: 2 },
    heading: { color: p.ink, fontSize: 17, fontWeight: '700' },
    attentionRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    attention: { flex: 1, color: p.ink2, fontSize: 15 },
    attentionUrgent: { color: p.wt, fontWeight: '700' },
    switch: { flexDirection: 'row', alignItems: 'center', minHeight: FOCUS.buttonText },
    switchText: { color: p.gt, fontSize: 16, fontWeight: '800' },
  })
}
