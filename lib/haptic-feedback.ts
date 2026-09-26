import * as Haptics from 'expo-haptics';

/**
 * Fire-and-forget one haptic, never letting it fail the action it decorates.
 *
 * expo-haptics calls return promises. Where haptics are unavailable (web, some
 * simulators) the promise can REJECT instead of throwing, and a synchronous
 * try/catch never sees that, so it surfaced as an unhandled rejection. Both
 * failure modes are swallowed here; `fallback`, when given, is tried once
 * instead.
 */
function fire(run: () => unknown, fallback?: () => unknown): void {
  const onFail = () => {
    if (fallback) fire(fallback);
  };
  try {
    const result = run();
    if (result && typeof (result as Promise<unknown>).catch === 'function') {
      (result as Promise<unknown>).catch(onFail);
    }
  } catch {
    onFail();
  }
}

/**
 * Haptic feedback utilities with safety checks.
 * Haptics are always triggered as they provide important feedback for accessibility,
 * independent of reduced motion preferences (which apply to visual animations).
 */
export const hapticFeedback = {
  // Light feedback for button presses and minor interactions
  light: () => fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),

  // Medium feedback for selections and confirmations
  medium: () => fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),

  // Heavy feedback for important actions like delete
  heavy: () => fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)),

  // Success feedback for completed actions
  success: () => fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),

  // Warning feedback for caution states
  warning: () => fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),

  // Error feedback for failed actions
  error: () => fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),

  // Selection feedback (for pickers, toggles, checkbox)
  selection: () => fire(() => Haptics.selectionAsync()),

  // Soft impact (iOS 13+) — falls back to light where unsupported
  soft: () =>
    fire(
      () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft),
      () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    ),

  // Rigid impact (iOS 13+) — falls back to heavy where unsupported
  rigid: () =>
    fire(
      () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid),
      () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)
    ),
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
    } catch {
      // Silently fail if haptics aren't supported
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