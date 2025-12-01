import * as Haptics from 'expo-haptics';

/**
 * Haptic feedback utilities with safety checks.
 * Haptics are always triggered as they provide important feedback for accessibility,
 * independent of reduced motion preferences (which apply to visual animations).
 */
export const hapticFeedback = {
  // Light feedback for button presses and minor interactions
  light: () => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {
      // Silently fail if haptics aren't supported
    }
  },
  
  // Medium feedback for selections and confirmations
  medium: () => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch {
      // Silently fail if haptics aren't supported
    }
  },
  
  // Heavy feedback for important actions like delete
  heavy: () => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    } catch {
      // Silently fail if haptics aren't supported
    }
  },
  
  // Success feedback for completed actions
  success: () => {
    try {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      // Silently fail if haptics aren't supported
    }
  },
  
  // Warning feedback for caution states
  warning: () => {
    try {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    } catch {
      // Silently fail if haptics aren't supported
    }
  },
  
  // Error feedback for failed actions
  error: () => {
    try {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } catch {
      // Silently fail if haptics aren't supported
    }
  },
  
  // Selection feedback (for pickers, toggles, checkbox)
  selection: () => {
    try {
      Haptics.selectionAsync();
    } catch {
      // Silently fail if haptics aren't supported
    }
  },

  // Rigid feedback (soft/rigid) - iOS 13+
  soft: () => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft);
    } catch {
      // Fallback to light if soft not supported
      try {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } catch {
        // Silently fail if not supported
      }
    }
  },

  rigid: () => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid);
    } catch {
      // Fallback to heavy if rigid not supported
      try {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      } catch {
        // Silently fail if not supported
      }
    }
  },
};

/**
 * Types of haptic feedback available
 */
export type HapticType = keyof typeof hapticFeedback;

/**
 * Hook for haptic feedback with error handling
 */
export function useHapticFeedback() {
  const triggerHaptic = (type: HapticType) => {
    try {
      hapticFeedback[type]();
    } catch (error) {
      // Silently fail if haptics aren't supported
      console.debug('Haptic feedback not available:', error);
    }
  };

  /**
   * Map common UI actions to their appropriate haptic feedback types
   */
  const mapActionToHaptic = (action: 'tap' | 'success' | 'error' | 'delete' | 'toggle' | 'drag'): HapticType => {
    switch (action) {
      case 'tap':
        return 'light';
      case 'success':
        return 'success';
      case 'error':
        return 'error';
      case 'delete':
        return 'heavy';
      case 'toggle':
        return 'selection';
      case 'drag':
        return 'soft';
      default:
        return 'light';
    }
  };

  return { 
    triggerHaptic,
    mapActionToHaptic,
    hapticFeedback,
  };
}