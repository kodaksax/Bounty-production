import * as Haptics from 'expo-haptics';

export const hapticFeedback = {
  // Light feedback for button presses
  light: () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  },
  
  // Medium feedback for selections
  medium: () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  },
  
  // Heavy feedback for important actions
  heavy: () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
  },
  
  // Success feedback
  success: () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  },
  
  // Warning feedback
  warning: () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  },
  
  // Error feedback
  error: () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  },
  
  // Selection feedback (for pickers, toggles)
  selection: () => {
    Haptics.selectionAsync();
  }
};

// Hook for haptic feedback with error handling
export function useHapticFeedback() {
  const triggerHaptic = (type: keyof typeof hapticFeedback) => {
    try {
      hapticFeedback[type]();
    } catch (error) {
      // Silently fail if haptics aren't supported
      console.debug('Haptic feedback not available:', error);
    }
  };

  return { triggerHaptic };
}