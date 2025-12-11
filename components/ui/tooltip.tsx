"use client"

import * as React from "react"
import { Modal, StyleSheet, Text, TouchableOpacity, View, Pressable, AccessibilityInfo } from "react-native"
import { MaterialIcons } from '@expo/vector-icons'

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
    return React.cloneElement(children as React.ReactElement, {
      ...props,
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
                  <MaterialIcons name="info-outline" size={24} color="#059669" />
                  <Text style={styles.title}>{title}</Text>
                  <TouchableOpacity 
                    onPress={() => setIsOpen?.(false)}
                    accessibilityLabel="Close"
                    accessibilityRole="button"
                    style={styles.closeButton}
                  >
                    <MaterialIcons name="close" size={20} color="#6b7280" />
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
  iconColor?: string
}

export const InfoTooltip: React.FC<InfoTooltipProps> = ({
  title,
  content,
  iconSize = 18,
  iconColor = '#10b981',
}) => {
  const [isOpen, setIsOpen] = React.useState(false)

  return (
    <View style={styles.infoTooltipContainer}>
      <TouchableOpacity
        onPress={() => {
          setIsOpen(true)
          AccessibilityInfo.announceForAccessibility(`${title}: ${content}`)
        }}
        accessibilityLabel={`Help: ${title}`}
        accessibilityRole="button"
        accessibilityHint="Opens help information"
        style={styles.infoIcon}
      >
        <MaterialIcons name="help-outline" size={iconSize} color={iconColor} />
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
                <MaterialIcons name="info-outline" size={24} color="#059669" />
                <Text style={styles.title}>{title}</Text>
                <TouchableOpacity 
                  onPress={() => setIsOpen(false)}
                  accessibilityLabel="Close"
                  accessibilityRole="button"
                  style={styles.closeButton}
                >
                  <MaterialIcons name="close" size={20} color="#6b7280" />
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

const styles = StyleSheet.create({
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
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 5,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 8,
  },
  title: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: '#1f2937',
  },
  description: {
    fontSize: 15,
    lineHeight: 22,
    color: '#4b5563',
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

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger }

