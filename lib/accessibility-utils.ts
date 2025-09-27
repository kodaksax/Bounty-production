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
      showSubscription?.remove();
      hideSubscription?.remove();
    };
  }, []);

  return keyboardInfo;
}

// Hook for managing focus between form fields
export function useFocusChain(fieldCount: number) {
  const fieldRefs = useRef<Array<any>>([]);
  const [currentFocusIndex, setCurrentFocusIndex] = useState(-1);

  const focusNext = () => {
    const nextIndex = currentFocusIndex + 1;
    if (nextIndex < fieldCount && fieldRefs.current[nextIndex]) {
      fieldRefs.current[nextIndex].focus();
      setCurrentFocusIndex(nextIndex);
    }
  };

  const focusPrevious = () => {
    const prevIndex = currentFocusIndex - 1;
    if (prevIndex >= 0 && fieldRefs.current[prevIndex]) {
      fieldRefs.current[prevIndex].focus();
      setCurrentFocusIndex(prevIndex);
    }
  };

  const setFieldRef = (index: number, ref: any) => {
    fieldRefs.current[index] = ref;
  };

  const handleFieldFocus = (index: number) => {
    setCurrentFocusIndex(index);
  };

  const handleFieldSubmitEditing = (index: number) => {
    if (index < fieldCount - 1) {
      focusNext();
    } else {
      // Last field, blur to submit form
      fieldRefs.current[index]?.blur();
    }
  };

  return {
    setFieldRef,
    handleFieldFocus,
    handleFieldSubmitEditing,
    focusNext,
    focusPrevious,
    currentFocusIndex,
  };
}

// Hook for keyboard avoiding behavior
export function useKeyboardAvoiding() {
  const keyboard = useKeyboard();
  
  const getKeyboardAvoidingStyle = () => ({
    paddingBottom: keyboard.isVisible ? keyboard.height : 0,
  });

  const getScrollViewStyle = () => ({
    flex: 1,
    ...getKeyboardAvoidingStyle(),
  });

  return {
    keyboard,
    getKeyboardAvoidingStyle,
    getScrollViewStyle,
    dismissKeyboard: Keyboard.dismiss,
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
  const announce = (message: string) => {
    // In React Native, we can use the accessibilityLiveRegion prop
    // This utility can be extended to manage announcement queues
    console.log('Screen reader announcement:', message);
  };

  const announceError = (error: string) => {
    announce(`Error: ${error}`);
  };

  const announceSuccess = (message: string) => {
    announce(`Success: ${message}`);
  };

  const announceLoading = (message: string = 'Loading') => {
    announce(message);
  };

  return {
    announce,
    announceError,
    announceSuccess,
    announceLoading,
  };
}