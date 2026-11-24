/**
 * The bottom sheet My Jobs uses for the switcher, Your offers and Who offered.
 * One sheet is open at a time (the screen owns which), so sheets never stack.
 */
import { MaterialIcons } from '@expo/vector-icons'
import * as React from 'react'
import { useMemo } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useAppThemeContext } from '../../lib/themes/AppThemeContext'
import type { AppTheme } from '../../lib/themes/types'

export interface MyJobsSheetProps {
  visible: boolean
  title: string
  subtitle?: string
  onClose: () => void
  /** Shows a back chevron instead of the close button. */
  onBack?: () => void
  children: React.ReactNode
  /**
   * False when the content brings its own virtualized list (a FlatList must
   * not sit inside a ScrollView).
   */
  scrollable?: boolean
  testID?: string
}

export function MyJobsSheet({ visible, title, subtitle, onClose, onBack, children, scrollable = true, testID }: MyJobsSheetProps) {
  const { theme } = useAppThemeContext()
  const s = useMemo(() => makeStyles(theme), [theme])
  const insets = useSafeAreaInsets()

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onBack ?? onClose}>
      <View style={s.backdrop} pointerEvents="none" />
      <View style={s.wrap}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
        <View style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]} testID={testID}>
          <View style={s.grabber} />
          <View style={s.header}>
            {onBack ? (
              <TouchableOpacity
                onPress={onBack}
                style={s.iconBtn}
                accessibilityRole="button"
                accessibilityLabel="Back"
                hitSlop={8}
              >
                <MaterialIcons name="chevron-left" size={26} color={theme.text} />
              </TouchableOpacity>
            ) : null}
            <View style={{ flex: 1 }}>
              <Text style={s.title} accessibilityRole="header">
                {title}
              </Text>
              {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}
            </View>
            <TouchableOpacity
              onPress={onClose}
              style={s.closeBtn}
              accessibilityRole="button"
              accessibilityLabel="Close"
              hitSlop={8}
            >
              <MaterialIcons name="close" size={22} color={theme.text} />
            </TouchableOpacity>
          </View>
          {scrollable ? (
            <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
              {children}
            </ScrollView>
          ) : (
            <View style={s.fixed}>{children}</View>
          )}
        </View>
      </View>
    </Modal>
  )
}

/** A small green, all-caps group heading inside a sheet: "JOBS YOU POSTED". */
export function SheetSectionLabel({ children }: { children: string }) {
  const { theme } = useAppThemeContext()
  return (
    <Text
      accessibilityRole="header"
      style={{
        color: theme.primaryLight,
        fontSize: 13,
        fontWeight: '800',
        letterSpacing: 0.6,
        textTransform: 'uppercase',
        marginTop: 8,
        marginBottom: 2,
      }}
    >
      {children}
    </Text>
  )
}

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
    wrap: { flex: 1, justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: t.surface,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      paddingHorizontal: 18,
      paddingTop: 10,
      maxHeight: '88%',
      borderWidth: 1,
      borderColor: t.border,
    },
    grabber: {
      alignSelf: 'center',
      width: 40,
      height: 5,
      borderRadius: 3,
      backgroundColor: t.border,
      marginBottom: 12,
    },
    header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
    iconBtn: { width: 36, height: 44, justifyContent: 'center' },
    closeBtn: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: t.surfaceSecondary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    title: { color: t.text, fontSize: 24, fontWeight: '800' },
    subtitle: { color: t.textSecondary, fontSize: 14, marginTop: 2 },
    content: { gap: 10, paddingBottom: 8 },
    fixed: { flexShrink: 1 },
  })
}
