/**
 * The My Jobs states with no featured job: nothing posted yet (E.0), nothing
 * needs you (only offers, or only old finished jobs) and couldn't load (E.1),
 * drawn with the Focus-first blocks.
 */
import { MaterialIcons } from '@expo/vector-icons'
import * as React from 'react'
import { useMemo } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useAppThemeContext } from '../../lib/themes/AppThemeContext'
import type { PosterPalette } from '../../lib/themes/poster-palette'
import { ConsequenceList, EmptyHero, NoteBox } from '../poster/blocks'
import { PosterButton } from '../poster/poster-button'

/** E.0 — nothing posted and no work: explain the space, truthfully about payment. */
export function MyJobsEmptyState({ onPostJob, onFindWork }: { onPostJob: () => void; onFindWork: () => void }) {
  return (
    <View style={{ gap: 20 }} testID="my-jobs-empty">
      <EmptyHero
        icon="add-task"
        title="Nothing posted yet"
        body="Your first job will appear here, with one clear next step at a time."
      />
      <ConsequenceList
        label="HOW IT WORKS"
        items={[
          { icon: 'edit-note', title: 'Describe the job and your price' },
          { icon: 'groups', title: 'People nearby offer to help' },
          { icon: 'handshake', title: 'Choose one. You pay only when you choose.' },
        ]}
      />
      <View style={{ gap: 4 }}>
        <PosterButton icon="add" label="Post your first job" onPress={onPostJob} testID="my-jobs-post-first" />
        {/* DESIGN-GAP: not in the poster handoff; an account that only does work starts here too. */}

      </View>
    </View>
  )
}

/** Nothing needs you — e.g. only offers waiting, or only older finished jobs. */
export function NothingNeedsYou({ message }: { message: string }) {
  const { theme } = useAppThemeContext()
  const p = theme.poster
  const s = useMemo(() => makeStyles(p), [p])
  return (
    <View style={s.calm} testID="my-jobs-nothing">
      <MaterialIcons name="check-circle" size={32} color={p.gt} />
      <Text style={s.calmTitle} accessibilityRole="header">
        {"You're all caught up"}
      </Text>
      <Text style={s.body}>{message}</Text>
    </View>
  )
}

/** E.1 — couldn't load. Reassures that nothing changed, and offers a retry. */
export function MyJobsErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <View style={{ gap: 16 }} testID="my-jobs-error">
      <NoteBox
        tone="e"
        icon="wifi-off"
        title="We couldn't load your jobs"
        text="Check your internet connection and try again."
        text2="Nothing about your jobs has changed."
      />
      <PosterButton icon="refresh" label="Try again" onPress={onRetry} testID="my-jobs-retry" />
    </View>
  )
}

function makeStyles(p: PosterPalette) {
  return StyleSheet.create({
    body: { color: p.ink2, fontSize: 17, lineHeight: 25 },
    calm: {
      backgroundColor: p.card,
      borderRadius: 24,
      borderWidth: 1,
      borderColor: p.line,
      padding: 24,
      gap: 8,
      alignItems: 'flex-start',
    },
    calmTitle: { color: p.ink, fontSize: 22, fontWeight: '800' },
  })
}
