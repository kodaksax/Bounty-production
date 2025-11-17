// hooks/useAnalytics.ts - Hook for tracking analytics events
import { useCallback, useEffect } from 'react';
import { AnalyticsEvent, AnalyticsProperties, analyticsService } from '../lib/services/analytics-service';
import { useAuthContext } from './use-auth-context';

/**
 * Hook for tracking analytics events with automatic user identification
 */
export function useAnalytics() {
  const { session, profile } = useAuthContext();

  const resolvedUserId = profile?.id ?? session?.user?.id;
  const resolvedEmail = profile?.email ?? session?.user?.email ?? undefined;
  const resolvedUsername = profile?.username ?? session?.user?.user_metadata?.username ?? undefined;

  // Identify user when authenticated
  useEffect(() => {
    if (resolvedUserId) {
      analyticsService
        .identifyUser(resolvedUserId, {
          email: resolvedEmail,
          username: resolvedUsername,
        })
        .catch(console.error);
    } else {
      // Reset analytics on logout
      analyticsService.reset().catch(console.error);
    }
  }, [resolvedUserId, resolvedEmail, resolvedUsername]);

  /**
   * Track an analytics event
   */
  const trackEvent = useCallback(
    async (event: AnalyticsEvent, properties?: AnalyticsProperties) => {
      await analyticsService.trackEvent(event, properties);
    },
    []
  );

  /**
   * Track a screen view
   */
  const trackScreenView = useCallback(
    async (screenName: string, properties?: AnalyticsProperties) => {
      await analyticsService.trackScreenView(screenName, properties);
    },
    []
  );

  /**
   * Update user properties
   */
  const updateUserProperties = useCallback(
    async (properties: AnalyticsProperties) => {
      await analyticsService.updateUserProperties(properties);
    },
    []
  );

  /**
   * Increment a user property
   */
  const incrementUserProperty = useCallback(
    async (property: string, value: number = 1) => {
      await analyticsService.incrementUserProperty(property, value);
    },
    []
  );

  return {
    trackEvent,
    trackScreenView,
    updateUserProperties,
    incrementUserProperty,
    isInitialized: analyticsService.isInitialized(),
    userId: analyticsService.getUserId(),
  };
}
