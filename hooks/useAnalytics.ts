// hooks/useAnalytics.ts - Hook for tracking analytics events
import { useCallback, useEffect } from 'react';
import { useAuthContext } from './use-auth-context';
import { analyticsService, AnalyticsEvent, AnalyticsProperties } from '../lib/services/analytics-service';

/**
 * Hook for tracking analytics events with automatic user identification
 */
export function useAnalytics() {
  const { user } = useAuthContext();

  // Identify user when authenticated
  useEffect(() => {
    if (user?.id) {
      analyticsService.identifyUser(user.id, {
        email: user.email,
        username: user.username,
      }).catch(console.error);
    } else {
      // Reset analytics on logout
      analyticsService.reset().catch(console.error);
    }
  }, [user?.id, user?.email, user?.username]);

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
