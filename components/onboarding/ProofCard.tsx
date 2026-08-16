/**
 * Rotating social-proof card for the poster_first welcome screen
 * (see PosterFirstWelcome.tsx). Fetches real completed/open bounties nearby
 * (lib/data/socialProofStub.ts) and rotates through them, falling back to a
 * static, non-factual card when there isn't enough real data.
 *
 * Data integrity: never renders a fabricated completed bounty. Falls back
 * completed -> open -> static in that order (see pickVariant below).
 */

import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, AppState, AppStateStatus, StyleSheet, Text, View } from 'react-native';
import { firstScreenStrings } from '../../lib/strings/firstScreen';
import { formatRelativeTime } from '../../lib/utils/date-utils';
import { fetchSocialProof, type ProofState, type SocialProofItem } from '../../lib/data/socialProofStub';
import { locationService } from '../../lib/services/location-service';
import type { AppTheme } from '../../lib/themes/types';

const ROTATE_INTERVAL_MS = 4000;
const CROSSFADE_MS = 150; // fade-out + fade-in = 300ms total
const IMPRESSION_DELAY_MS = 1000;

// Minimum real completed bounties required before showing the completed
// variant at all; below that we fall back to open bounties nearby.
const MIN_COMPLETED_FOR_VARIANT = 3;

export type ProofCardDisplayState = ProofState | 'fallback';

export interface ProofCardActiveItem {
  index: number;
  proofState: ProofCardDisplayState;
  bountyId: string | null;
}

interface DisplayCard {
  bountyId: string | null;
  proofState: ProofCardDisplayState;
  body: string;
  meta: string;
}

function formatAmount(cents: number): string {
  return `$${Math.round(cents / 100)}`;
}

function formatDistance(miles: number | null): string | null {
  if (miles === null) return null;
  return Math.max(miles, 0.3).toFixed(1);
}

function toDisplayCard(item: SocialProofItem): DisplayCard {
  const amount = formatAmount(item.amount_cents);
  const distance = formatDistance(item.distance_miles);
  const relativeTime = formatRelativeTime(new Date(item.timestamp));

  if (item.state === 'completed') {
    return {
      bountyId: item.id,
      proofState: 'completed',
      body: firstScreenStrings.proofCardCompletedBody(item.hunter_first_name, item.task_summary, item.neighborhood),
      meta: firstScreenStrings.proofCardCompletedMeta(amount, distance, relativeTime),
    };
  }

  return {
    bountyId: item.id,
    proofState: 'open',
    body: firstScreenStrings.proofCardOpenBody(item.neighborhood, item.task_summary),
    meta: firstScreenStrings.proofCardOpenMeta(amount, distance, relativeTime),
  };
}

const FALLBACK_CARD: DisplayCard = {
  bountyId: null,
  proofState: 'fallback',
  body: firstScreenStrings.fallbackCardBody,
  meta: firstScreenStrings.fallbackCardMeta,
};

/** completed -> open -> static, per the non-negotiable data integrity rules. */
function pickCards(items: SocialProofItem[]): DisplayCard[] {
  const completed = items.filter(item => item.state === 'completed');
  if (completed.length >= MIN_COMPLETED_FOR_VARIANT) {
    return completed.map(toDisplayCard);
  }

  const open = items.filter(item => item.state === 'open');
  if (open.length > 0) {
    return open.map(toDisplayCard);
  }

  return [FALLBACK_CARD];
}

interface ProofCardProps {
  theme: AppTheme;
  /** True once the user has tapped any CTA — freezes rotation permanently. */
  stopped: boolean;
  onActiveChange?: (item: ProofCardActiveItem) => void;
  onImpression?: (item: ProofCardActiveItem) => void;
}

export function ProofCard({ theme, stopped, onActiveChange, onImpression }: ProofCardProps) {
  const styles = makeStyles(theme);
  const [cards, setCards] = useState<DisplayCard[]>([FALLBACK_CARD]);
  const [index, setIndex] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const opacity = useRef(new Animated.Value(1)).current;
  const cardsRef = useRef(cards);
  cardsRef.current = cards;

  // Fetch on mount, non-blocking — the fallback card is already rendered.
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      let lat: number | undefined;
      let lng: number | undefined;

      try {
        const permission = await locationService.getPermissionStatus();
        if (permission.granted) {
          const coords = await locationService.getCurrentLocation();
          if (coords) {
            lat = coords.latitude;
            lng = coords.longitude;
          }
        }
      } catch {
        // Coarse location is a nice-to-have here; proceed without it.
      }

      try {
        const response = await fetchSocialProof({ lat, lng, limit: 8 });
        if (!cancelled) setCards(pickCards(response.items));
      } catch {
        if (!cancelled) setCards([FALLBACK_CARD]);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Reduce Motion: disable rotation entirely, render the first item statically.
  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then(enabled => {
        if (!cancelled) setReduceMotion(enabled);
      })
      .catch(() => {});
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', enabled => {
      setReduceMotion(enabled);
    });
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  // Pause while backgrounded, resume on foreground.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      setAppActive(next === 'active');
    });
    return () => {
      subscription.remove();
    };
  }, []);

  // Rotation loop.
  useEffect(() => {
    if (stopped || reduceMotion || !appActive || cards.length <= 1) return;

    const timer = setInterval(() => {
      Animated.timing(opacity, { toValue: 0, duration: CROSSFADE_MS, useNativeDriver: true }).start(() => {
        setIndex(prev => (prev + 1) % cardsRef.current.length);
        Animated.timing(opacity, { toValue: 1, duration: CROSSFADE_MS, useNativeDriver: true }).start();
      });
    }, ROTATE_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [stopped, reduceMotion, appActive, cards.length, opacity]);

  // Clamp index if the card list shrinks (e.g. fetch resolves with fewer items).
  const safeIndex = index < cards.length ? index : 0;
  const active = cards[safeIndex];

  // Notify parent of the active card (for CTA-tap analytics) and fire the
  // impression event once it's been shown for >=1s.
  useEffect(() => {
    const activeItem: ProofCardActiveItem = {
      index: safeIndex,
      proofState: active.proofState,
      bountyId: active.bountyId,
    };
    onActiveChange?.(activeItem);

    const timer = setTimeout(() => onImpression?.(activeItem), IMPRESSION_DELAY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeIndex, active.proofState, active.bountyId]);

  return (
    <View style={styles.container}>
      <Animated.View
        style={{ opacity: reduceMotion ? 1 : opacity }}
        accessibilityRole="text"
        accessibilityLiveRegion="polite"
        accessibilityLabel={`${active.body} ${active.meta}`}
      >
        <Text style={styles.body} numberOfLines={2}>
          {active.body}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {active.meta}
        </Text>
      </Animated.View>
    </View>
  );
}

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
    container: {
      backgroundColor: theme.overlay,
      borderRadius: theme.radius.xl,
      borderWidth: 1,
      borderColor: theme.border,
      padding: 20,
      marginHorizontal: 24,
      minHeight: 108,
      justifyContent: 'center',
    },
    body: {
      fontSize: 17,
      lineHeight: 24,
      fontWeight: '500',
      color: theme.text,
      textAlign: 'center',
    },
    meta: {
      fontSize: 14,
      fontWeight: '600',
      color: theme.primary,
      textAlign: 'center',
      marginTop: 8,
    },
  });
}
