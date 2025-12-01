import React from 'react';
import { 
  View, 
  Text, 
  ActivityIndicator, 
  StyleSheet, 
  Animated,
  AccessibilityInfo,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { SPACING, TYPOGRAPHY } from '../../lib/constants/accessibility';

interface LoadingOverlayProps {
  /**
   * Whether the loading overlay is visible
   */
  visible: boolean;
  /**
   * Loading message to display
   */
  message?: string;
  /**
   * Show as full screen overlay vs inline
   * @default false
   */
  fullScreen?: boolean;
  /**
   * Show progress percentage (0-100)
   */
  progress?: number;
  /**
   * Optional icon to show instead of spinner
   */
  icon?: keyof typeof MaterialIcons.glyphMap;
  /**
   * Transparent background
   * @default false
   */
  transparent?: boolean;
}

/**
 * Loading overlay component with optional progress indicator.
 * Accessible and respects reduced motion preferences.
 */
export function LoadingOverlay({
  visible,
  message,
  fullScreen = false,
  progress,
  icon,
  transparent = false,
}: LoadingOverlayProps) {
  const fadeAnim = React.useRef(new Animated.Value(0)).current;
  const [prefersReducedMotion, setPrefersReducedMotion] = React.useState(false);

  // Check for reduced motion preference
  React.useEffect(() => {
    const checkMotionPreference = async () => {
      try {
        const isReduceMotionEnabled = await AccessibilityInfo.isReduceMotionEnabled();
        setPrefersReducedMotion(isReduceMotionEnabled);
      } catch {
        setPrefersReducedMotion(false);
      }
    };
    checkMotionPreference();
  }, []);

  // Animate in/out
  React.useEffect(() => {
    const animDuration = prefersReducedMotion ? 0 : 200;
    
    Animated.timing(fadeAnim, {
      toValue: visible ? 1 : 0,
      duration: animDuration,
      useNativeDriver: true,
    }).start();
  }, [visible, fadeAnim, prefersReducedMotion]);

  if (!visible) return null;

  const hasProgress = typeof progress === 'number';

  return (
    <Animated.View 
      style={[
        styles.container,
        fullScreen && styles.fullScreen,
        transparent && styles.transparent,
        { opacity: fadeAnim },
      ]}
      accessibilityRole="progressbar"
      accessibilityLabel={message || 'Loading'}
      accessibilityValue={hasProgress ? { now: progress, min: 0, max: 100 } : undefined}
      accessibilityLiveRegion="polite"
    >
      <View style={styles.content}>
        {icon ? (
          <MaterialIcons 
            name={icon} 
            size={40} 
            color="#10b981" 
            accessibilityElementsHidden={true}
          />
        ) : (
          <ActivityIndicator size="large" color="#10b981" />
        )}
        
        {message && (
          <Text style={styles.message}>{message}</Text>
        )}
        
        {hasProgress && (
          <View style={styles.progressContainer}>
            <View style={styles.progressTrack}>
              <View 
                style={[
                  styles.progressBar, 
                  { width: `${Math.min(100, Math.max(0, progress))}%` }
                ]} 
              />
            </View>
            <Text style={styles.progressText}>{Math.round(progress)}%</Text>
          </View>
        )}
      </View>
    </Animated.View>
  );
}

/**
 * Inline loading indicator for buttons and small areas
 */
interface InlineLoadingProps {
  /**
   * Text to display next to spinner
   */
  text?: string;
  /**
   * Size of the indicator
   * @default "small"
   */
  size?: 'small' | 'large';
  /**
   * Color of the indicator
   * @default "#10b981"
   */
  color?: string;
}

export function InlineLoading({
  text,
  size = 'small',
  color = '#10b981',
}: InlineLoadingProps) {
  return (
    <View 
      style={styles.inlineContainer}
      accessibilityRole="progressbar"
      accessibilityLabel={text || 'Loading'}
      accessibilityLiveRegion="polite"
    >
      <ActivityIndicator size={size} color={color} />
      {text && (
        <Text style={[styles.inlineText, { color }]}>{text}</Text>
      )}
    </View>
  );
}

/**
 * Loading dots animation for minimal loading indication
 */
export function LoadingDots() {
  const [dots, setDots] = React.useState('.');
  
  React.useEffect(() => {
    const interval = setInterval(() => {
      setDots(prev => prev.length >= 3 ? '.' : prev + '.');
    }, 500);
    
    return () => clearInterval(interval);
  }, []);

  return (
    <Text 
      style={styles.dots}
      accessibilityLabel="Loading"
      accessibilityRole="progressbar"
    >
      {dots}
    </Text>
  );
}

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(5, 46, 27, 0.9)',
    borderRadius: 16,
    padding: SPACING.SECTION_GAP,
    minWidth: 120,
    minHeight: 100,
  },
  fullScreen: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 0,
    zIndex: 1000,
  },
  transparent: {
    backgroundColor: 'transparent',
  },
  content: {
    alignItems: 'center',
    gap: SPACING.ELEMENT_GAP,
  },
  message: {
    color: '#d1fae5',
    fontSize: TYPOGRAPHY.SIZE_BODY,
    fontWeight: '500',
    textAlign: 'center',
    marginTop: SPACING.COMPACT_GAP,
  },
  progressContainer: {
    width: '100%',
    alignItems: 'center',
    gap: SPACING.COMPACT_GAP,
    marginTop: SPACING.COMPACT_GAP,
  },
  progressTrack: {
    width: '100%',
    height: 6,
    backgroundColor: 'rgba(110, 231, 183, 0.2)',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#10b981',
    borderRadius: 3,
  },
  progressText: {
    color: '#6ee7b7',
    fontSize: TYPOGRAPHY.SIZE_SMALL,
    fontWeight: '600',
  },
  inlineContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.COMPACT_GAP,
  },
  inlineText: {
    fontSize: TYPOGRAPHY.SIZE_SMALL,
    fontWeight: '500',
  },
  dots: {
    color: '#10b981',
    fontSize: TYPOGRAPHY.SIZE_LARGE,
    fontWeight: 'bold',
    width: 24,
  },
});

export default LoadingOverlay;
