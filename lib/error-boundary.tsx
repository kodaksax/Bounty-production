/**
 * Global Error Boundary
 * Catches all React errors and provides graceful fallback UI
 * Sends error logs to Sentry for monitoring
 */

import { MaterialIcons } from '@expo/vector-icons';
import React, { Component, ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { COLORS, SIZING, SPACING, TYPOGRAPHY } from './constants/accessibility';
import { getSentry } from './services/sentry-init';
import { getUserFriendlyError, type UserFriendlyError } from './utils/error-messages';

interface ErrorBoundaryProps {
  children: ReactNode;
  /**
   * Callback when error is caught (for logging, analytics, etc.)
   */
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
  /**
   * Custom fallback UI renderer
   */
  fallback?: (error: UserFriendlyError, reset: () => void) => ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Global Error Boundary Component
 * Wraps the app to catch all unhandled React errors
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    // Update state so the next render will show the fallback UI
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Log error details to console in development
    if (__DEV__) {
      console.error('[ErrorBoundary] Caught error:', error);
      console.error('[ErrorBoundary] Error info:', errorInfo);
    }

    // Send to Sentry for monitoring (if available)
    try {
      const Sentry = getSentry?.();
      if (Sentry && typeof Sentry.captureException === 'function') {
        Sentry.captureException(error, {
          contexts: {
            react: {
              componentStack: errorInfo.componentStack,
            },
          },
          level: 'error',
          tags: {
            error_boundary: 'global',
          },
        });
      }
    } catch (sentryError) {
      console.error('[ErrorBoundary] Failed to send to Sentry:', sentryError);
    }

    // Call custom error handler if provided
    if (this.props.onError) {
      try {
        this.props.onError(error, errorInfo);
      } catch (handlerError) {
        console.error('[ErrorBoundary] Error in onError handler:', handlerError);
      }
    }
  }

  /**
   * Reset error boundary state
   * Called when user taps "Try Again"
   */
  resetError = () => {
    this.setState({
      hasError: false,
      error: null,
    });
  };

  render() {
    if (this.state.hasError && this.state.error) {
      // Get user-friendly error message with fallback
      let userError: UserFriendlyError;
      try {
        userError = getUserFriendlyError(this.state.error);
      } catch (conversionError) {
        // Fallback if error conversion fails
        console.error('[ErrorBoundary] Failed to convert error:', conversionError);
        userError = {
          type: 'unknown',
          title: 'Something Went Wrong',
          message: 'An unexpected error occurred. Please restart the app.',
          retryable: false,
        };
      }

      // Use custom fallback if provided
      if (this.props.fallback) {
        return this.props.fallback(userError, this.resetError);
      }

      // Default fallback UI
      return <DefaultErrorFallback error={userError} onReset={this.resetError} />;
    }

    return this.props.children;
  }
}

/**
 * Default error fallback UI
 * Shows user-friendly error message with retry option
 */
function DefaultErrorFallback({
  error,
  onReset,
}: {
  error: UserFriendlyError;
  onReset: () => void;
}) {
  const iconName = getIconForErrorType(error.type);
  const iconColor = error.type === 'validation' ? '#f59e0b' : '#dc2626';

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.content}>
          {/* Error Icon */}
          <View style={[styles.iconContainer, { backgroundColor: `${iconColor}20` }]}>
            <MaterialIcons
              name={iconName}
              size={64}
              color={iconColor}
              accessibilityElementsHidden
            />
          </View>

          {/* Error Title */}
          <Text
            style={styles.title}
            accessibilityRole="header"
          >
            {error.title}
          </Text>

          {/* Error Message */}
          <Text
            style={styles.message}
            accessibilityRole="text"
          >
            {error.message}
          </Text>

          {/* Action Buttons */}
          <View style={styles.actions}>
            {error.retryable && (
              <TouchableOpacity
                style={[styles.button, styles.primaryButton]}
                onPress={onReset}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={error.action || 'Try again'}
                accessibilityHint="Attempt to recover from the error"
              >
                <MaterialIcons name="refresh" size={20} color="#fff" />
                <Text style={styles.primaryButtonText}>
                  {error.action || 'Try Again'}
                </Text>
              </TouchableOpacity>
            )}

            {!error.retryable && (
              <Text style={styles.helpText}>
                Please restart the app or contact support if the problem persists.
              </Text>
            )}
          </View>

          {/* Development-only error details */}
          {__DEV__ && (
            <View style={styles.devInfo}>
              <Text style={styles.devTitle}>Development Info:</Text>
              <Text style={styles.devText} selectable>
                Error Type: {error.type}
              </Text>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

/**
 * Get appropriate icon for error type
 */
function getIconForErrorType(type: UserFriendlyError['type']): keyof typeof MaterialIcons.glyphMap {
  switch (type) {
    case 'network':
      return 'wifi-off';
    case 'authentication':
      return 'lock-outline';
    case 'authorization':
      return 'block';
    case 'payment':
      return 'payment';
    case 'rate_limit':
      return 'access-time';
    case 'not_found':
      return 'search-off';
    case 'validation':
      return 'warning';
    case 'server':
      return 'cloud-off';
    case 'navigation':
      return 'navigation';
    case 'database':
      return 'storage';
    default:
      return 'error-outline';
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.EMERALD_500,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: SPACING.SCREEN_HORIZONTAL,
    paddingVertical: SPACING.SCREEN_VERTICAL,
  },
  content: {
    maxWidth: 400,
    width: '100%',
    alignItems: 'center',
  },
  iconContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: SPACING.SECTION_GAP,
  },
  title: {
    color: '#fff',
    fontSize: TYPOGRAPHY.SIZE_LARGE,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: SPACING.ELEMENT_GAP,
  },
  message: {
    color: '#fff',
    fontSize: TYPOGRAPHY.SIZE_BODY,
    textAlign: 'center',
    lineHeight: TYPOGRAPHY.SIZE_BODY * TYPOGRAPHY.LINE_HEIGHT_RELAXED,
    opacity: 0.9,
    marginBottom: SPACING.SECTION_GAP,
  },
  actions: {
    width: '100%',
    alignItems: 'center',
    gap: SPACING.ELEMENT_GAP,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.SECTION_GAP,
    paddingVertical: SPACING.ELEMENT_GAP,
    borderRadius: 12,
    minHeight: SIZING.MIN_TOUCH_TARGET,
    gap: SPACING.COMPACT_GAP,
    width: '100%',
    maxWidth: 280,
  },
  primaryButton: {
    backgroundColor: '#fff',
  },
  primaryButtonText: {
    color: COLORS.EMERALD_600,
    fontSize: TYPOGRAPHY.SIZE_BODY,
    fontWeight: '700',
  },
  helpText: {
    color: '#fff',
    fontSize: TYPOGRAPHY.SIZE_SMALL,
    textAlign: 'center',
    opacity: 0.8,
    marginTop: SPACING.ELEMENT_GAP,
  },
  devInfo: {
    marginTop: SPACING.SECTION_GAP,
    padding: SPACING.ELEMENT_GAP,
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
    borderRadius: 8,
    width: '100%',
  },
  devTitle: {
    color: '#fff',
    fontSize: TYPOGRAPHY.SIZE_SMALL,
    fontWeight: '700',
    marginBottom: SPACING.COMPACT_GAP,
  },
  devText: {
    color: '#fff',
    fontSize: TYPOGRAPHY.SIZE_SMALL,
    fontFamily: 'monospace',
    opacity: 0.8,
  },
});
