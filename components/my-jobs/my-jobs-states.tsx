/**
 * The My Jobs states with no featured job: nothing posted yet (E.0), nothing
 * needs you (only offers, or only old finished jobs) and couldn't load (E.1).
 */
import { MaterialIcons } from '@expo/vector-icons'
import * as React from 'react'
import { useMemo } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import type { IconName } from '../../lib/my-jobs/types'
import { useAppThemeContext } from '../../lib/themes/AppThemeContext'
import type { AppTheme } from '../../lib/themes/types'

const HOW_IT_WORKS: { icon: IconName; text: string }[] = [
  { icon: 'edit-note', text: 'Describe the job and your price' },
  { icon: 'groups', text: 'People nearby offer to help' },
  { icon: 'handshake', text: 'Choose one. You pay only when you choose.' },
]

function PrimaryButton({ label, icon, onPress, testID }: { label: string; icon: IconName; onPress: () => void; testID?: string }) {
  const { theme } = useAppThemeContext()
  const s = useMemo(() => makeStyles(theme), [theme])
  return (
    <TouchableOpacity onPress={onPress} style={s.primary} accessibilityRole="button" accessibilityLabel={label} testID={testID}>
      <MaterialIcons name={icon} size={22} color={theme.onPrimary} />
      <Text style={s.primaryText}>{label}</Text>
    </TouchableOpacity>
  )
}

/** E.0 — nothing posted and no work: explain the space, truthfully about payment. */
export function MyJobsEmptyState({ onPostJob, onFindWork }: { onPostJob: () => void; onFindWork: () => void }) {
  const { theme } = useAppThemeContext()
  const s = useMemo(() => makeStyles(theme), [theme])
  return (
    <View style={s.wrap} testID="my-jobs-empty">
      <View style={s.badge}>
        <MaterialIcons name="add-task" size={40} color={theme.onPrimary} />
      </View>
      <Text style={s.title} accessibilityRole="header">
        Nothing posted yet
      </Text>
      <Text style={s.body}>Your first job will appear here, with one clear next step at a time.</Text>
      <Text style={s.label}>How it works</Text>
      <View style={{ gap: 12 }}>
        {HOW_IT_WORKS.map((step) => (
          <View key={step.text} style={s.step}>
            <View style={s.stepIcon}>
              <MaterialIcons name={step.icon} size={18} color={theme.primaryLight} />
            </View>
            <Text style={s.stepText}>{step.text}</Text>
          </View>
        ))}
      </View>
      <PrimaryButton label="Post your first job" icon="add" onPress={onPostJob} testID="my-jobs-post-first" />
      <TouchableOpacity onPress={onFindWork} style={s.secondary} accessibilityRole="button">
        <Text style={s.secondaryText}>Or find work nearby</Text>
      </TouchableOpacity>
    </View>
  )
}

/** Nothing needs you — e.g. only offers waiting, or only older finished jobs. */
export function NothingNeedsYou({ message }: { message: string }) {
  const { theme } = useAppThemeContext()
  const s = useMemo(() => makeStyles(theme), [theme])
  return (
    <View style={s.calm} testID="my-jobs-nothing">
      <MaterialIcons name="check-circle" size={32} color={theme.primaryLight} />
      <Text style={s.calmTitle}>You're all caught up</Text>
      <Text style={s.body}>{message}</Text>
    </View>
  )
}

/** E.1 — couldn't load. Reassures that nothing changed, and offers a retry. */
export function MyJobsErrorState({ onRetry }: { onRetry: () => void }) {
  const { theme } = useAppThemeContext()
  const s = useMemo(() => makeStyles(theme), [theme])
  return (
    <View style={[s.wrap, { alignItems: 'center' }]} testID="my-jobs-error">
      <MaterialIcons name="wifi-off" size={44} color={theme.textSecondary} />
      <Text style={[s.title, { textAlign: 'center' }]} accessibilityRole="header">
        We couldn't load your jobs
      </Text>
      <Text style={[s.body, { textAlign: 'center' }]}>Check your internet connection and try again.</Text>
      <Text style={[s.body, { textAlign: 'center', fontWeight: '700' }]}>Nothing about your jobs has changed.</Text>
      <View style={{ alignSelf: 'stretch' }}>
        <PrimaryButton label="Try again" icon="refresh" onPress={onRetry} testID="my-jobs-retry" />
      </View>
    </View>
  )
}

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    wrap: { gap: 12, paddingTop: 8 },
    badge: {
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor: t.primary,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 8,
      borderColor: t.primaryTint,
    },
    title: { color: t.text, fontSize: 28, fontWeight: '800', marginTop: 4 },
    body: { color: t.textSecondary, fontSize: 16, lineHeight: 23 },
    label: {
      color: t.primaryLight,
      fontSize: 13,
      fontWeight: '800',
      letterSpacing: 0.6,
      textTransform: 'uppercase',
      marginTop: 8,
    },
    step: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    stepIcon: {
      width: 34,
      height: 34,
      borderRadius: 17,
      backgroundColor: t.primaryTint,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepText: { flex: 1, color: t.text, fontSize: 16, fontWeight: '700' },
    primary: {
      marginTop: 16,
      minHeight: 56,
      borderRadius: 16,
      backgroundColor: t.primary,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },
    primaryText: { color: t.onPrimary, fontSize: 18, fontWeight: '800' },
    secondary: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
    secondaryText: { color: t.primaryLight, fontSize: 16, fontWeight: '700' },
    calm: {
      backgroundColor: t.surface,
      borderRadius: 24,
      borderWidth: 1,
      ...t.insetBorder,
      padding: 24,
      gap: 8,
      alignItems: 'flex-start',
    },
    calmTitle: { color: t.text, fontSize: 22, fontWeight: '800' },
  })
}
