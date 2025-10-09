import { useEffect, useRef, useState } from 'react';
import { Keyboard, KeyboardEventListener, Platform } from 'react-native';

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

// Hook for managing focus between form fields
export function useFocusChain(fieldCount: number) {
  const refs = useRef<any[]>(Array(fieldCount).fill(null));

  const focusNext = (currentIndex: number) => {
    if (currentIndex < fieldCount - 1) {
      refs.current[currentIndex + 1]?.focus();
    }
  };

  const focusPrevious = (currentIndex: number) => {
    if (currentIndex > 0) {
      refs.current[currentIndex - 1]?.focus();
    }
  };

  const setRef = (index: number, ref: any) => {
    refs.current[index] = ref;
  };

  return { refs: refs.current, focusNext, focusPrevious, setRef };
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
export function useReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    // Check for reduced motion preference
    // This would typically check system settings
    // For now, we'll just set it to false as a fallback
    setPrefersReducedMotion(false);
  }, []);

  const getAnimationConfig = (duration: number = 200) => ({
    duration: prefersReducedMotion ? 0 : duration,
    useNativeDriver: true,
  });

  return {
    prefersReducedMotion,
    getAnimationConfig,
  };
}

// Utility for managing screen reader announcements
export function useScreenReaderAnnouncements() {
  const [announcement, setAnnouncement] = useState<string>('');

  const announce = (message: string, delay: number = 100) => {
    setTimeout(() => {
      setAnnouncement(message);
      // Clear after announcement
      setTimeout(() => setAnnouncement(''), 1000);
    }, delay);
  };

  return {
    announcement,
    announce,
  };
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
