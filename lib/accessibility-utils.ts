import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Keyboard, KeyboardEventListener, Platform, TextInput } from 'react-native';

interface KeyboardInfo {
  isVisible: boolean;
  height: number;
  animationDuration?: number;
}

export function useKeyboard(): KeyboardInfo {
  const [keyboardInfo, setKeyboardInfo] = useState<KeyboardInfo>({
    isVisible: false,
    height: 0,
  });

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const handleKeyboardShow: KeyboardEventListener = (event) => {
      setKeyboardInfo({
        isVisible: true,
        height: event.endCoordinates.height,
        animationDuration: event.duration,
      });
    };

    const handleKeyboardHide: KeyboardEventListener = (event) => {
      setKeyboardInfo({
        isVisible: false,
        height: 0,
        animationDuration: event.duration,
      });
    };

    const showSubscription = Keyboard.addListener(showEvent, handleKeyboardShow);
    const hideSubscription = Keyboard.addListener(hideEvent, handleKeyboardHide);

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  return keyboardInfo;
}

// Hook for managing focus between form fields with enhanced keyboard handling
export function useFocusChain(fieldCount: number) {
  const refs = useRef<Array<TextInput | null>>(Array(fieldCount).fill(null));

  const focusNext = useCallback((currentIndex: number) => {
    if (currentIndex < fieldCount - 1) {
      refs.current[currentIndex + 1]?.focus();
    } else {
      // Last field - dismiss keyboard
      Keyboard.dismiss();
    }
  }, [fieldCount]);

  const focusPrevious = useCallback((currentIndex: number) => {
    if (currentIndex > 0) {
      refs.current[currentIndex - 1]?.focus();
    }
  }, []);

  const setRef = useCallback((index: number, ref: TextInput | null) => {
    refs.current[index] = ref;
  }, []);

  // Get return key type based on position
  const getReturnKeyType = useCallback((index: number): 'next' | 'done' | 'go' => {
    if (index < fieldCount - 1) {
      return 'next';
    }
    return 'done';
  }, [fieldCount]);

  // Handle submit editing - focuses next or submits
  const getSubmitHandler = useCallback((index: number, onSubmit?: () => void) => {
    return () => {
      if (index < fieldCount - 1) {
        focusNext(index);
      } else {
        Keyboard.dismiss();
        onSubmit?.();
      }
    };
  }, [fieldCount, focusNext]);

  return { 
    refs: refs.current, 
    focusNext, 
    focusPrevious, 
    setRef, 
    getReturnKeyType,
    getSubmitHandler,
  };
}

// Hook for keyboard avoiding behavior
export function useKeyboardAvoiding() {
  const keyboard = useKeyboard();

  const getBottomOffset = (additionalOffset = 0) => {
    return keyboard.isVisible ? keyboard.height + additionalOffset : additionalOffset;
  };

  return {
    keyboardHeight: keyboard.height,
    keyboardVisible: keyboard.isVisible,
    getBottomOffset,
  };
}

// Utility for handling reduced motion preferences
// Uses native AccessibilityInfo for accurate system setting detection
export function useReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    // Check initial reduced motion preference
    AccessibilityInfo.isReduceMotionEnabled()
      .then(setPrefersReducedMotion)
      .catch(() => setPrefersReducedMotion(false));

    // Subscribe to changes
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (isEnabled) => {
        setPrefersReducedMotion(isEnabled);
      }
    );

    return () => {
      subscription.remove();
    };
  }, []);

  const getAnimationConfig = useCallback((duration: number = 200) => ({
    duration: prefersReducedMotion ? 0 : duration,
    useNativeDriver: true,
  }), [prefersReducedMotion]);

  // Get spring animation config that respects reduced motion
  const getSpringConfig = useCallback((tension = 80, friction = 12) => ({
    tension: prefersReducedMotion ? 1000 : tension,
    friction: prefersReducedMotion ? 1000 : friction,
    useNativeDriver: true,
  }), [prefersReducedMotion]);

  return {
    prefersReducedMotion,
    getAnimationConfig,
    getSpringConfig,
  };
}

// Utility for managing screen reader announcements
export function useScreenReaderAnnouncements() {
  const [announcement, setAnnouncement] = useState<string>('');

  const announce = useCallback((message: string, delay: number = 100) => {
    setTimeout(() => {
      setAnnouncement(message);
      // Also announce through the native accessibility API
      AccessibilityInfo.announceForAccessibility(message);
      // Clear after announcement
      setTimeout(() => setAnnouncement(''), 1000);
    }, delay);
  }, []);

  return {
    announcement,
    announce,
  };
}

// Hook for checking if screen reader is enabled
export function useScreenReader() {
  const [isScreenReaderEnabled, setIsScreenReaderEnabled] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isScreenReaderEnabled()
      .then(setIsScreenReaderEnabled)
      .catch(() => setIsScreenReaderEnabled(false));

    const subscription = AccessibilityInfo.addEventListener(
      'screenReaderChanged',
      (isEnabled) => {
        setIsScreenReaderEnabled(isEnabled);
      }
    );

    return () => {
      subscription.remove();
    };
  }, []);

  return isScreenReaderEnabled;
}

// Focus trap utility for modals/dialogs
export function useFocusTrap(isActive: boolean) {
  const firstFocusableRef = useRef<any>(null);
  const lastFocusableRef = useRef<any>(null);

  useEffect(() => {
    if (isActive && firstFocusableRef.current) {
      firstFocusableRef.current?.focus();
    }
  }, [isActive]);

  const handleFirstElementKeyDown = (event: any) => {
    if (event.key === 'Tab' && event.shiftKey) {
      event.preventDefault();
      lastFocusableRef.current?.focus();
    }
  };

  const handleLastElementKeyDown = (event: any) => {
    if (event.key === 'Tab' && !event.shiftKey) {
      event.preventDefault();
      firstFocusableRef.current?.focus();
    }
  };

  return {
    firstFocusableRef,
    lastFocusableRef,
    handleFirstElementKeyDown,
    handleLastElementKeyDown,
  };
}

// Helper to generate accessibility props for touch targets
export function getTouchTargetProps(minSize = 44) {
  return {
    hitSlop: {
      top: Math.max(0, (minSize - 24) / 2),
      bottom: Math.max(0, (minSize - 24) / 2),
      left: Math.max(0, (minSize - 24) / 2),
      right: Math.max(0, (minSize - 24) / 2),
    },
  };
}

// Utility to check if element meets minimum touch target size
export function ensureMinTouchTarget(
  width: number,
  height: number,
  minSize = 44
): { width: number; height: number } {
  return {
    width: Math.max(width, minSize),
    height: Math.max(height, minSize),
  };
}
