/**
 * Small building blocks shared by the My Jobs components: the job thumbnail,
 * the side label, the "Needs you" marker, and the list of manage actions.
 */
import { MaterialIcons } from '@expo/vector-icons'
import { Image as ExpoImage } from 'expo-image'
import * as React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import type { ManageAction } from '../../lib/my-jobs/manage-actions'
import type { IconName, JobSide } from '../../lib/my-jobs/types'
import { useAppThemeContext } from '../../lib/themes/AppThemeContext'
import { SidePill } from '../poster/side-label'

/** The job's photo, or its category icon on a warm tile. */
export function JobThumb({
  coverUri,
  icon,
  size = 48,
  bordered = false,
}: {
  coverUri: string | null
  icon: IconName
  size?: number
  bordered?: boolean
}) {
  const { theme } = useAppThemeContext()
  const box = {
    width: size,
    height: size,
    borderRadius: Math.round(size / 4),
    backgroundColor: theme.surfaceSecondary,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    overflow: 'hidden' as const,
    ...(bordered ? { borderWidth: 2, borderColor: theme.surface } : null),
  }
  return (
    <View style={box} accessible={false} importantForAccessibility="no-hide-descendants">
      {coverUri ? (
        <ExpoImage source={{ uri: coverUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
      ) : (
        <MaterialIcons name={icon} size={Math.round(size * 0.46)} color={theme.text} />
      )}
    </View>
  )
}

/**
 * Which side of the job the user is on — words first, then icon and colour,
 * never colour alone. Only shown when the account has jobs on both sides.
 * Drawn by the shared SidePill so My Jobs and the workspaces label sides the
 * same way (the handoff's mapping: posted green, offered neutral, doing blue).
 */
export function JobSideLabel({ side, finished = false }: { side: JobSide | 'offered'; finished?: boolean }) {
  const pill = side === 'doing' && finished ? 'did' : side
  return <SidePill side={pill} testID={`side-label-${side}`} />
}

/** "Needs you", in words, with the bell as support. */
export function NeedsYouMarker({ compact = false }: { compact?: boolean }) {
  const { theme } = useAppThemeContext()
  return (
    <View style={bitStyles.needsYou}>
      <MaterialIcons name="notifications-active" size={compact ? 16 : 18} color={theme.poster.wt} />
      <Text style={[bitStyles.needsYouText, { color: theme.poster.wt, fontSize: compact ? 14 : 15 }]}>
        Needs you
      </Text>
    </View>
  )
}

/**
 * A job's manage actions as full-width rows. Danger actions are red; a
 * disabled action is dimmed but still tappable, so it can explain itself.
 */
export function ManageActionsList({
  actions,
  onSelect,
  title,
}: {
  actions: ManageAction[]
  onSelect: (action: ManageAction) => void
  /** Used for accessibility labels: "Take this job down, Clear my garage". */
  title?: string
}) {
  const { theme } = useAppThemeContext()
  if (actions.length === 0) return null
  return (
    <View style={{ gap: 2 }}>
      {actions.map((action) => {
        const danger = action.tone === 'danger'
        const color = danger ? theme.errorText : theme.text
        const disabled = !!action.disabledReason
        return (
          <TouchableOpacity
            key={action.key}
            onPress={() => onSelect(action)}
            style={[bitStyles.actionRow, disabled && { opacity: 0.55 }]}
            accessibilityRole="button"
            accessibilityLabel={title ? `${action.label}, ${title}` : action.label}
            accessibilityHint={disabled ? action.disabledReason : undefined}
            accessibilityState={{ disabled }}
            testID={`manage-action-${action.key}`}
          >
            <MaterialIcons name={action.icon} size={20} color={color} />
            <Text style={[bitStyles.actionText, { color }]}>{action.label}</Text>
          </TouchableOpacity>
        )
      })}
    </View>
  )
}

const bitStyles = StyleSheet.create({
  needsYou: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  needsYouText: { fontWeight: '800' },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48, paddingHorizontal: 4 },
  actionText: { fontSize: 16, fontWeight: '600' },
})
