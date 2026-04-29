/**
 * Global Error Boundary
 * Catches all React errors and provides graceful fallback UI
 * Sends error logs to Sentry for monitoring
 */

import { MaterialIcons } from '@expo/vector-icons';
import React, { Component, ReactNode, useState } from 'react';
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
  // React error boundaries can receive non-Error throwables (strings, plain
  // objects, etc.). Type as `unknown` so the fallback UI never assumes shape.
  error: unknown;
  componentStack: string | null;
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
      componentStack: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    // Update state so the next render will show the fallback UI
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Capture the React component stack so the fallback UI can surface it for
    // diagnostics in release builds (where stack traces are otherwise hidden).
    try {
      this.setState({ componentStack: errorInfo.componentStack ?? null });
    } catch {
      // ignore — the boundary is already showing a fallback regardless
    }

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
      componentStack: null,
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
      return (
        <DefaultErrorFallback
          error={userError}
          rawError={this.state.error}
          componentStack={this.state.componentStack}
          onReset={this.resetError}
        />
      );
    }

    return this.props.children;
  }
}

/**
 * Default error fallback UI
 * Shows user-friendly error message with retry option, plus a collapsible
 * technical-details panel that stays available in release builds. Surfacing
 * the underlying error message + first stack frames is intentional: without
 * it, users hitting an unrecoverable startup error in a release build (where
 * `__DEV__` is false and Sentry may not yet have initialised) have no way to
 * report what actually went wrong. The details are hidden behind a disclosure
 * so the friendly UI is unchanged for users who don't tap into them.
 */
function DefaultErrorFallback({
  error,
  rawError,
  componentStack,
  onReset,
}: {
  error: UserFriendlyError;
  rawError?: unknown;
  componentStack?: string | null;
  onReset: () => void;
}) {
  const iconName = getIconForErrorType(error.type);
  const iconColor = error.type === 'validation' ? '#f59e0b' : '#dc2626';
  const [showDetails, setShowDetails] = useState(false);

  const technicalDetails = formatTechnicalDetails(rawError ?? null, componentStack ?? null);

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

          {/* Technical details — collapsible. Available in release builds so
              users can capture / share the underlying error when triaging
              startup crashes that the friendly message has sanitised away. */}
          {technicalDetails ? (
            <View style={styles.devInfo}>
              <TouchableOpacity
                onPress={() => setShowDetails((v) => !v)}
                accessibilityRole="button"
                accessibilityLabel={showDetails ? 'Hide technical details' : 'Show technical details'}
                accessibilityHint="Toggles a panel containing the raw error message and stack trace"
                activeOpacity={0.7}
                style={styles.devToggleRow}
              >
                <Text style={styles.devToggleLabel}>
                  {showDetails ? 'Hide technical details' : 'Show technical details'}
                </Text>
                <MaterialIcons
                  name={showDetails ? 'expand-less' : 'expand-more'}
                  size={20}
                  color="#fff"
                />
              </TouchableOpacity>
              {showDetails && (
                <Text style={styles.devText} selectable>
                  {technicalDetails}
                </Text>
              )}
            </View>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

/**
 * Build a human-readable, copy-friendly technical-details string for the
 * fallback UI. Returns null if there is nothing useful to display.
 *
 * Hardened against non-Error throwables (strings, plain objects, null) — React
 * only types `componentDidCatch`'s argument as `Error`, but JS allows anything
 * to be thrown. This function must never crash the fallback UI itself.
 *
 * Sensitive substrings (URL query params, Bearer/JWT tokens, Stripe API keys)
 * are redacted before rendering so the panel — which is now visible in
 * release builds for triage — does not leak secrets/PII into a screenshot or
 * support copy-paste.
 */
const MAX_STACK_LINES = 8;

const SENSITIVE_VALUE_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  // Authorization headers / token strings
  [/\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED]'],
  [/\bJWT\s+[A-Za-z0-9\-._~+/]+=*/gi, 'JWT [REDACTED]'],
  // Bare JWTs (three base64url segments separated by dots, starting with the
  // canonical `eyJ` prefix that decodes to `{"`). Catches tokens leaked into
  // URLs, headers, or error messages without an explicit `Bearer`/`JWT` label.
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[JWT_REDACTED]'],
  // Stripe API keys (live and test)
  [/\bsk_(?:live|test)_[A-Za-z0-9]+/gi, 'sk_[REDACTED]'],
  [/\bpk_(?:live|test)_[A-Za-z0-9]+/gi, 'pk_[REDACTED]'],
];

function safeToString(value: unknown): string {
  try {
    return String(value);
  } catch {
    return '[unstringifiable thrown value]';
  }
}

function stripUrlQueryParams(value: string): string {
  // Redact both query string AND fragment because OAuth implicit-flow tokens
  // arrive in the fragment (e.g. `#access_token=…&id_token=…`) and other
  // services occasionally push session IDs there too. The path is preserved
  // so stack frames still pinpoint the failing endpoint or asset.
  return value.replace(/https?:\/\/[^\s)]+/gi, (match) => {
    const queryIndex = match.indexOf('?');
    const hashIndex = match.indexOf('#');

    if (queryIndex === -1 && hashIndex === -1) return match;

    // Whichever marker comes first determines where the path ends.
    const cutIndex =
      queryIndex === -1
        ? hashIndex
        : hashIndex === -1
          ? queryIndex
          : Math.min(queryIndex, hashIndex);

    const base = match.slice(0, cutIndex);
    const hasQuery = queryIndex !== -1;
    const hasHash = hashIndex !== -1;

    if (hasQuery && hasHash) {
      return `${base}?[REDACTED]#[REDACTED]`;
    }
    if (hasQuery) {
      return `${base}?[REDACTED]`;
    }
    return `${base}#[REDACTED]`;
  });
}

export function redactSensitiveTechnicalDetails(value: string): string {
  let sanitized = stripUrlQueryParams(value);
  for (const [pattern, replacement] of SENSITIVE_VALUE_PATTERNS) {
    sanitized = sanitized.replace(pattern, replacement);
  }
  return sanitized;
}

function getThrowableDetails(error: unknown): {
  name: string;
  message: string;
  stack: string | null;
} {
  if (error instanceof Error) {
    return {
      name: error.name || 'Error',
      message: error.message || safeToString(error),
      stack: typeof error.stack === 'string' && error.stack ? error.stack : null,
    };
  }

  if (typeof error === 'object' && error !== null) {
    const maybeError = error as { name?: unknown; message?: unknown; stack?: unknown };
    const name =
      typeof maybeError.name === 'string' && maybeError.name ? maybeError.name : 'Error';
    const message =
      typeof maybeError.message === 'string' && maybeError.message
        ? maybeError.message
        : safeToString(error);
    const stack =
      typeof maybeError.stack === 'string' && maybeError.stack ? maybeError.stack : null;
    return { name, message, stack };
  }

  return { name: 'Error', message: safeToString(error), stack: null };
}

export function formatTechnicalDetails(
  error: unknown,
  componentStack: string | null
): string | null {
  if (error == null && !componentStack) return null;
  const parts: string[] = [];
  if (error != null) {
    const { name, message, stack } = getThrowableDetails(error);
    parts.push(redactSensitiveTechnicalDetails(`${name}: ${message}`));
    if (stack) {
      // Trim long stacks so the panel stays scrollable but still useful for
      // pinpointing the failing module. First few frames typically identify
      // the offending file.
      const stackLines = redactSensitiveTechnicalDetails(
        stack.split('\n').slice(0, MAX_STACK_LINES).join('\n')
      );
      parts.push(stackLines);
    }
  }
  if (componentStack) {
    const compLines = redactSensitiveTechnicalDetails(
      componentStack.split('\n').filter(Boolean).slice(0, MAX_STACK_LINES).join('\n')
    );
    if (compLines) {
      parts.push(`Component stack:\n${compLines}`);
    }
  }
  return parts.join('\n\n');
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
  devToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: SIZING.MIN_TOUCH_TARGET,
  },
  devToggleLabel: {
    color: '#fff',
    fontSize: TYPOGRAPHY.SIZE_SMALL,
    fontWeight: '700',
  },
  devText: {
    color: '#fff',
    fontSize: TYPOGRAPHY.SIZE_SMALL,
    fontFamily: 'monospace',
    opacity: 0.8,
    marginTop: SPACING.COMPACT_GAP,
  },
});
