"use client"

import { MaterialIcons } from '@expo/vector-icons'
import * as React from "react"
import { AccessibilityInfo, Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native"
import { useAppThemeContext } from '../../lib/themes/AppThemeContext'
import type { AppTheme } from '../../lib/themes/types'


// Enhanced RN Tooltip with mobile-friendly modal presentation
// Provides helpful context for complex features

const TooltipProvider: React.FC<any> = ({ children }) => <>{children}</>

interface TooltipProps {
  children: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

const Tooltip: React.FC<TooltipProps> = ({ children }) => {
  const [isOpen, setIsOpen] = React.useState(false)

  return (
    <>
      {React.Children.map(children, (child) => {
        if (React.isValidElement(child)) {
          return React.cloneElement(child as React.ReactElement<any>, {
            isOpen,
            setIsOpen,
          })
        }
        return child
      })}
    </>
  )
}

interface TooltipTriggerProps {
  asChild?: boolean
  children: React.ReactNode
  isOpen?: boolean
  setIsOpen?: (open: boolean) => void
}

const TooltipTrigger = ({ asChild = false, children, isOpen, setIsOpen, ...props }: TooltipTriggerProps) => {
  const handlePress = () => {
    setIsOpen?.(!isOpen)
    AccessibilityInfo.announceForAccessibility('Help information opened')
  }

  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(children as React.ReactElement<any>, {
      onPress: handlePress,
    })
  }

  return (
    <TouchableOpacity
      {...props}
      onPress={handlePress}
      accessibilityLabel="Show help information"
      accessibilityRole="button"
      accessibilityHint="Opens a dialog with additional information"
    >
      {children}
    </TouchableOpacity>
  )
}

interface TooltipContentProps {
  children: React.ReactNode
  title?: string
  isOpen?: boolean
  setIsOpen?: (open: boolean) => void
  side?: 'top' | 'bottom' | 'left' | 'right'
  align?: 'start' | 'center' | 'end'
}

const TooltipContent = React.forwardRef<View, TooltipContentProps>(
  ({ children, title, isOpen, setIsOpen, ...props }, ref) => {
    const { theme } = useAppThemeContext()
    const styles = React.useMemo(() => makeStyles(theme), [theme])

    if (!isOpen) return null

    return (
      <Modal
        visible={isOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setIsOpen?.(false)}
      >
        <Pressable
          style={styles.overlay}
          onPress={() => setIsOpen?.(false)}
          accessibilityLabel="Close help information"
          accessibilityRole="button"
        >
          <View
            ref={ref}
            style={styles.contentContainer}
            {...props}
          >
            <View style={styles.content}>
              {title && (
                <View style={styles.header}>
                  <MaterialIcons name="info-outline" size={24} color={theme.primary} />
                  <Text style={[styles.title, { marginLeft: 8 }]}>{title}</Text>
                  <TouchableOpacity
                    onPress={() => setIsOpen?.(false)}
                    accessibilityLabel="Close"
                    accessibilityRole="button"
                    style={styles.closeButton}
                  >
                    <MaterialIcons name="close" size={20} color={theme.textSecondary} />
                  </TouchableOpacity>
                </View>
              )}
              <Text style={styles.description}>{children}</Text>
            </View>
          </View>
        </Pressable>
      </Modal>
    )
  }
)
TooltipContent.displayName = "TooltipContent"

/**
 * InfoTooltip - Convenient component for adding help icons with tooltips
 * Usage: <InfoTooltip title="What is escrow?" content="Escrow protects..." />
 */
interface InfoTooltipProps {
  title: string
  content: string
  iconSize?: number
  /** Defaults to the theme's primary brand color when omitted. */
  iconColor?: string
}

export const InfoTooltip: React.FC<InfoTooltipProps> = ({
  title,
  content,
  iconSize = 18,
  iconColor,
}) => {
  const [isOpen, setIsOpen] = React.useState(false)
  const { theme } = useAppThemeContext()
  const styles = React.useMemo(() => makeStyles(theme), [theme])
  const resolvedIconColor = iconColor ?? theme.primary

  return (
    <View style={styles.infoTooltipContainer}>
      <TouchableOpacity
        onPress={() => {
          setIsOpen(true)
          AccessibilityInfo.announceForAccessibility(title)
        }}
        accessibilityLabel={`Help: ${title}`}
        accessibilityRole="button"
        accessibilityHint="Opens help information"
        style={styles.infoIcon}
      >
        <MaterialIcons name="help-outline" size={iconSize} color={resolvedIconColor} />
      </TouchableOpacity>

      <Modal
        visible={isOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setIsOpen(false)}
      >
        <Pressable
          style={styles.overlay}
          onPress={() => setIsOpen(false)}
          accessibilityLabel="Close help information"
          accessibilityRole="button"
        >
          <View style={styles.contentContainer}>
            <View style={styles.content}>
              <View style={styles.header}>
                <MaterialIcons name="info-outline" size={24} color={theme.primary} />
                <Text style={[styles.title, { marginLeft: 8 }]}>{title}</Text>
                <TouchableOpacity
                  onPress={() => setIsOpen(false)}
                  accessibilityLabel="Close"
                  accessibilityRole="button"
                  style={styles.closeButton}
                >
                  <MaterialIcons name="close" size={20} color={theme.textSecondary} />
                </TouchableOpacity>
              </View>
              <Text style={styles.description}>{content}</Text>
            </View>
          </View>
        </Pressable>
      </Modal>
    </View>
  )
}

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      justifyContent: 'center',
      alignItems: 'center',
      padding: 20,
    },
    contentContainer: {
      maxWidth: 400,
      width: '100%',
    },
    content: {
      backgroundColor: theme.surface,
      borderRadius: 12,
      padding: 20,
      borderWidth: 1,
      borderColor: theme.border,
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: theme.isDark ? 0.4 : 0.1,
      shadowRadius: 4,
      elevation: 3,
    },

    header: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 12,
    },
    title: {
      flex: 1,
      fontSize: 18,
      fontWeight: '700',
      color: theme.text,
    },
    description: {
      fontSize: 15,
      lineHeight: 22,
      color: theme.textSecondary,
    },
    closeButton: {
      padding: 4,
    },
    infoTooltipContainer: {
      justifyContent: 'center',
      alignItems: 'center',
    },
    infoIcon: {
      padding: 4,
    },
  })
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger }
