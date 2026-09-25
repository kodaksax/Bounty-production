import { MaterialIcons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  PanResponder,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type { Bounty } from '../lib/services/database.types';
import { SIZING, SPACING } from '../lib/constants/accessibility';
import { storage } from '../lib/storage';
import { useAppThemeContext } from '../lib/themes/AppThemeContext';
import type { AppTheme } from '../lib/themes/types';

// Where the viewer's own bounty sits in its lifecycle, as the poster sees it.
// 'review' is not a bounty status: it's an in_progress bounty whose latest
// completion submission is still pending (same rule My Postings uses for its
// "Review needed" badge).
export type BountyProgressStage = 'open' | 'in_progress' | 'review';

export type MyBountyProgressItem = { bounty: Bounty; stage: BountyProgressStage };

const STAGES: {
  key: BountyProgressStage;
  label: string;
  headline: string;
  icon: keyof typeof MaterialIcons.glyphMap;
}[] = [
  { key: 'open', label: 'Open', headline: 'Waiting for a hunter', icon: 'person-search' },
  {
    key: 'in_progress',
    label: 'In progress',
    headline: 'A hunter is on it',
    icon: 'directions-run',
  },
  { key: 'review', label: 'Needs review', headline: 'Ready for your review', icon: 'fact-check' },
];

// The reward pill keeps its own bright green in both modes.
const ACCENT = '#4ADE80';
const ACCENT_TEXT = '#052E16';

// Card colors. Frosted glass in both modes: the blur softens whatever feed
// content is behind, and `bg` is a fairly opaque tint on top of it so text
// stays easy to read however busy that content is. (On Android, where
// expo-blur doesn't blur by default, the tint alone is the background.)
type CardPalette = {
  bg: string;
  blurTint: 'dark' | 'light';
  border: string;
  text: string;
  muted: string;
  track: string;
  /** Faint marks: grab handle, upcoming stage dots, inactive page dots. */
  subtle: string;
  /** Active page dot, tab icon. */
  strong: string;
};

function makePalette(theme: AppTheme): CardPalette {
  if (theme.isDark) {
    return {
      bg: 'rgba(16,20,19,0.72)',
      blurTint: 'dark',
      border: 'rgba(255,255,255,0.12)',
      text: '#ffffff',
      muted: 'rgba(255,255,255,0.6)',
      track: 'rgba(255,255,255,0.14)',
      subtle: 'rgba(255,255,255,0.3)',
      strong: '#ffffff',
    };
  }
  return {
    bg: 'rgba(255,255,255,0.72)',
    blurTint: 'light',
    border: 'rgba(0,0,0,0.08)',
    text: theme.text,
    muted: theme.textSecondary,
    track: 'rgba(0,0,0,0.08)',
    subtle: 'rgba(0,0,0,0.2)',
    strong: theme.text,
  };
}

function useCardStyles() {
  const { theme } = useAppThemeContext();
  const palette = useMemo(() => makePalette(theme), [theme]);
  const styles = useMemo(() => makeStyles(palette), [palette]);
  return { theme, palette, styles };
}

const STAGE_RANK: Record<BountyProgressStage, number> = { open: 0, in_progress: 1, review: 2 };

/**
 * Card order: furthest-along stage first (Needs review, then In progress, then
 * Open), so what needs the poster's attention is the card they land on. Within
 * a stage, oldest posted first — it has been waiting the longest.
 */
export function sortByProgress(items: MyBountyProgressItem[]): MyBountyProgressItem[] {
  return [...items].sort((a, b) => {
    const byStage = STAGE_RANK[b.stage] - STAGE_RANK[a.stage];
    if (byStage !== 0) return byStage;
    return (
      new Date(a.bounty.created_at ?? 0).getTime() - new Date(b.bounty.created_at ?? 0).getTime()
    );
  });
}

type CarouselProps = {
  items: MyBountyProgressItem[];
  onPressItem: (bounty: Bounty) => void;
};

const STASHED_KEY = 'BE:bountyProgressStashed';
// How far up (as a share of the card's height) a drag has to travel, or how
// fast it has to be flicked, before letting go sends the card away.
const STASH_DISTANCE = 0.3;
const STASH_VELOCITY = 0.6;
// Extra travel past the card's own height so its shadow clears the top too.
const OFFSCREEN_EXTRA = 24;

/**
 * Floating progress cards that hover over the top of the feed, like the Maps
 * walking banner over a phone's home screen. The feed underneath never moves.
 *
 * - Swipe sideways to page between bounties (one card per live bounty).
 * - Swipe up to send the cards off the top; a small tab stays hanging from
 *   the top edge so it's clear they're still there. Tap the tab, or pull it
 *   down, to bring them back. Remembered across launches.
 *
 * Render it as the last child of a `position: relative` container: it
 * positions itself absolutely over that container's top.
 */
export function MyBountyProgressCarousel({ items, onPressItem }: CarouselProps) {
  const { palette, styles } = useCardStyles();
  const [width, setWidth] = useState(0);
  // Natural height of the card block; 0 until first measured.
  const [contentHeight, setContentHeight] = useState(0);
  const [stashed, setStashed] = useState(false);
  // Don't draw anything until the remembered stashed state is read, so a
  // stashed stack doesn't flash in on launch.
  const [hydrated, setHydrated] = useState(false);

  // Vertical offset of the cards: 0 = showing, hiddenOffset() = off the top.
  const drag = useRef(new Animated.Value(0)).current;
  const heightRef = useRef(0);
  heightRef.current = contentHeight;
  const hiddenOffset = () => -(heightRef.current + OFFSCREEN_EXTRA);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const saved = await storage.getItem(STASHED_KEY);
        if (!cancelled && saved === 'true') setStashed(true);
      } catch {}
      if (!cancelled) setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep a stashed stack fully off screen if its height changes.
  useEffect(() => {
    if (stashed) drag.setValue(-(contentHeight + OFFSCREEN_EXTRA));
  }, [stashed, contentHeight, drag]);

  const persist = (value: boolean) => {
    storage.setItem(STASHED_KEY, String(value)).catch?.(() => {});
  };

  const springHome = useCallback(() => {
    Animated.spring(drag, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
  }, [drag]);

  const stash = useCallback(() => {
    Animated.timing(drag, {
      toValue: hiddenOffset(),
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(() => setStashed(true));
    persist(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag]);

  const expand = useCallback(() => {
    setStashed(false);
    springHome();
    persist(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [springHome]);

  // Dragging the cards. Claims only clearly vertical moves (capture phase, so
  // it wins over the card's tap), leaving sideways swipes to the pager.
  const cardsPan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_, g) =>
          Math.abs(g.dy) > 8 && Math.abs(g.dy) > Math.abs(g.dx) * 1.5,
        onPanResponderTerminationRequest: () => false,
        // Follows the finger up freely; downward it only gives a little, so
        // it feels held in place rather than stuck.
        onPanResponderMove: (_, g) => drag.setValue(g.dy < 0 ? g.dy : g.dy * 0.15),
        onPanResponderRelease: (_, g) => {
          if (g.dy < -heightRef.current * STASH_DISTANCE || g.vy < -STASH_VELOCITY) stash();
          else springHome();
        },
        onPanResponderTerminate: springHome,
      }),
    [drag, stash, springHome]
  );

  // Pulling the tab down draws the cards back in under the finger.
  const tabPan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
        onPanResponderMove: (_, g) =>
          drag.setValue(Math.min(0, hiddenOffset() + Math.max(0, g.dy))),
        onPanResponderRelease: (_, g) => {
          if (g.dy > heightRef.current * STASH_DISTANCE || g.vy > STASH_VELOCITY) expand();
          else
            Animated.timing(drag, {
              toValue: hiddenOffset(),
              duration: 160,
              useNativeDriver: true,
            }).start();
        },
        onPanResponderTerminate: () => drag.setValue(hiddenOffset()),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [drag, expand]
  );

  if (!hydrated) return null;

  return (
    <View
      style={styles.overlay}
      pointerEvents="box-none"
      onLayout={e => setWidth(e.nativeEvent.layout.width)}
    >
      {stashed && (
        <View style={styles.tabRow} pointerEvents="box-none" {...tabPan.panHandlers}>
          <TouchableOpacity
            style={styles.tab}
            activeOpacity={0.85}
            onPress={expand}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityRole="button"
            accessibilityLabel={`Your bounty progress is hidden${
              items.length > 1 ? `, ${items.length} bounties` : ''
            }`}
            accessibilityHint="Shows it again"
            testID="feed-my-bounty-progress-tab"
          >
            <BlurView intensity={40} tint={palette.blurTint} style={StyleSheet.absoluteFill} />
            <View style={styles.tabDot} />
            {items.length > 1 && <Text style={styles.tabCount}>{items.length}</Text>}
            <MaterialIcons name="expand-more" size={16} color={palette.strong} />
          </TouchableOpacity>
        </View>
      )}

      <Animated.View
        style={[styles.cards, { transform: [{ translateY: drag }] }]}
        pointerEvents={stashed ? 'none' : 'box-none'}
        importantForAccessibility={stashed ? 'no-hide-descendants' : 'auto'}
        onLayout={e => setContentHeight(e.nativeEvent.layout.height)}
        {...cardsPan.panHandlers}
      >
        {width > 0 && (
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            scrollEnabled={items.length > 1}
          >
            {items.map((item, i) => (
              <View key={String(item.bounty.id)} style={{ width }}>
                <MyBountyProgressBanner
                  bounty={item.bounty}
                  stage={item.stage}
                  position={items.length > 1 ? { index: i, total: items.length } : undefined}
                  onPress={() => onPressItem(item.bounty)}
                  onHide={stash}
                />
              </View>
            ))}
          </ScrollView>
        )}
      </Animated.View>
    </View>
  );
}

type Props = {
  bounty: Pick<Bounty, 'id' | 'title' | 'amount' | 'is_for_honor'>;
  stage: BountyProgressStage;
  /** Set when shown in a carousel of several, for the screen-reader label. */
  position?: { index: number; total: number };
  onPress: () => void;
  /** Tucks the cards away — the screen-reader stand-in for dragging them up. */
  onHide?: () => void;
};

export function MyBountyProgressBanner({ bounty, stage, position, onPress, onHide }: Props) {
  // The progress line follows the app theme's brand color.
  const { theme, palette, styles } = useCardStyles();
  const index = Math.max(
    0,
    STAGES.findIndex(st => st.key === stage)
  );
  const current = STAGES[index];
  const fillPct = (index / (STAGES.length - 1)) * 100;
  const reward = bounty.is_for_honor ? 'For honor' : `$${Number(bounty.amount || 0)}`;

  return (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.85}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${
        position ? `Bounty ${position.index + 1} of ${position.total}. ` : ''
      }Your bounty ${bounty.title}: ${current.label}, step ${index + 1} of ${STAGES.length}. ${
        current.headline
      }.`}
      accessibilityHint={
        position
          ? 'Opens the bounty. Swipe left or right for your other bounties.'
          : 'Opens the bounty'
      }
      accessibilityActions={
        onHide ? [{ name: 'activate' }, { name: 'hide', label: 'Hide' }] : undefined
      }
      onAccessibilityAction={e => {
        if (e.nativeEvent.actionName === 'hide') onHide?.();
        else onPress();
      }}
      testID="feed-my-bounty-progress"
    >
      <BlurView intensity={40} tint={palette.blurTint} style={StyleSheet.absoluteFill} />
      <View style={styles.headerRow}>
        <View style={styles.headerText}>
          <Text style={styles.headline} numberOfLines={1}>
            {current.headline}
          </Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {bounty.title}
          </Text>
        </View>
        <View style={styles.pill}>
          <Text style={styles.pillText} numberOfLines={1}>
            {reward}
          </Text>
        </View>
      </View>

      {/* Track: a grey rail, a green fill up to the current stage, and one node
          per stage. The current node is the larger marker with its icon. */}
      <View style={styles.trackWrap}>
        <View style={styles.trackRail} />
        <View
          style={[styles.trackFill, { width: `${fillPct}%`, backgroundColor: theme.primary }]}
        />
        <View style={styles.nodesRow}>
          {STAGES.map((st, i) =>
            i === index ? (
              <LiveMarker key={st.key} icon={st.icon} color={theme.primary} styles={styles} />
            ) : (
              <View
                key={st.key}
                style={[styles.dot, i < index ? styles.dotDone : styles.dotTodo]}
              />
            )
          )}
        </View>
      </View>

      <View style={styles.labelsRow}>
        {STAGES.map((st, i) => (
          <Text
            key={st.key}
            style={[
              styles.label,
              i === 0 ? styles.labelStart : i === STAGES.length - 1 ? styles.labelEnd : null,
              i === index && styles.labelCurrent,
            ]}
            numberOfLines={1}
          >
            {st.label}
          </Text>
        ))}
      </View>

      {/* Which of several cards this is. Inside the card rather than under
          it, so it stays readable over whatever feed content is beneath. */}
      {position && (
        <View style={styles.dotsRow} importantForAccessibility="no-hide-descendants">
          {Array.from({ length: position.total }, (_, i) => (
            <View key={i} style={[styles.pageDot, i === position.index && styles.pageDotActive]} />
          ))}
        </View>
      )}

      {/* Grab handle: says "this can be swiped away" the way a sheet's does. */}
      {onHide && <View style={styles.grabber} />}
    </TouchableOpacity>
  );
}

// The "live" pulse: one soft disc of the marker's color breathes out from
// behind it and fades, then a rest before the next. Slow and low-contrast on
// purpose — it should register as "this is happening now", not ask for a tap.
const PULSE_MS = 1600;
const PULSE_REST_MS = 1000;
const PULSE_MAX_SCALE = 1.9;
const PULSE_START_OPACITY = 0.35;

function LiveMarker({
  icon,
  color,
  styles,
}: {
  icon: keyof typeof MaterialIcons.glyphMap;
  color: string;
  styles: ReturnType<typeof makeStyles>;
}) {
  const pulse = useRef(new Animated.Value(0)).current;
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then(v => !cancelled && setReduceMotion(v))
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', setReduceMotion);
    return () => {
      cancelled = true;
      sub?.remove?.();
    };
  }, []);

  useEffect(() => {
    if (reduceMotion) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: PULSE_MS,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        // Invisible at 1 (fully faded), so snapping back during the rest
        // never shows.
        Animated.timing(pulse, {
          toValue: 0,
          duration: 0,
          delay: PULSE_REST_MS,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [reduceMotion, pulse]);

  return (
    <View style={styles.markerWrap}>
      {!reduceMotion && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.markerPulse,
            {
              backgroundColor: color,
              opacity: pulse.interpolate({
                inputRange: [0, 1],
                outputRange: [PULSE_START_OPACITY, 0],
              }),
              transform: [
                {
                  scale: pulse.interpolate({
                    inputRange: [0, 1],
                    outputRange: [1, PULSE_MAX_SCALE],
                  }),
                },
              ],
            },
          ]}
        />
      )}
      <View style={[styles.marker, { backgroundColor: color }]}>
        <MaterialIcons name={icon} size={16} color="#ffffff" />
      </View>
    </View>
  );
}

const MARKER = 28;
const DOT = 8;

function makeStyles(p: CardPalette) {
  return StyleSheet.create({
    // Covers the top of whatever it's placed in; above the feed's bottom fade.
    overlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      zIndex: 60,
      elevation: 60,
    },
    cards: {
      paddingTop: SPACING.COMPACT_GAP,
    },

    // Hangs from the top edge when the cards are swiped away. Small on purpose:
    // it sits over the search row, so it only has to say "still here".
    tabRow: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      alignItems: 'center',
    },
    tab: {
      flexDirection: 'row',
      alignItems: 'center',
      height: 22,
      paddingLeft: 10,
      paddingRight: 6,
      borderBottomLeftRadius: 11,
      borderBottomRightRadius: 11,
      overflow: 'hidden',
      backgroundColor: p.bg,
    },
    tabDot: {
      width: 7,
      height: 7,
      borderRadius: 3.5,
      backgroundColor: ACCENT,
      marginRight: 4,
    },
    tabCount: {
      color: p.text,
      fontSize: 11,
      fontWeight: '700',
      marginLeft: 2,
    },
    grabber: {
      alignSelf: 'center',
      width: 32,
      height: 4,
      borderRadius: 2,
      backgroundColor: p.subtle,
      marginTop: 10,
      marginBottom: -4,
    },
    dotsRow: {
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      marginTop: 12,
    },
    pageDot: {
      width: 5,
      height: 5,
      borderRadius: 2.5,
      marginHorizontal: 2.5,
      backgroundColor: p.subtle,
    },
    pageDotActive: {
      width: 14,
      backgroundColor: p.strong,
    },

    card: {
      marginHorizontal: SPACING.SCREEN_HORIZONTAL,
      paddingHorizontal: 18,
      paddingTop: 16,
      paddingBottom: 14,
      minHeight: SIZING.MIN_TOUCH_TARGET,
      borderRadius: 24,
      // Clips the blur to the rounded corners.
      overflow: 'hidden',
      backgroundColor: p.bg,
      borderWidth: 1,
      borderColor: p.border,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    headerText: {
      flex: 1,
      marginRight: 12,
    },
    headline: {
      color: p.text,
      fontSize: 17,
      fontWeight: '700',
    },
    subtitle: {
      color: p.muted,
      fontSize: 13,
      fontWeight: '500',
      marginTop: 2,
    },
    pill: {
      backgroundColor: ACCENT,
      borderRadius: 999,
      paddingHorizontal: 14,
      paddingVertical: 6,
    },
    pillText: {
      color: ACCENT_TEXT,
      fontSize: 15,
      fontWeight: '800',
    },

    trackWrap: {
      height: MARKER,
      marginTop: 16,
      justifyContent: 'center',
    },
    trackRail: {
      position: 'absolute',
      left: 0,
      right: 0,
      height: 10,
      borderRadius: 5,
      backgroundColor: p.track,
    },
    trackFill: {
      position: 'absolute',
      left: 0,
      height: 10,
      borderRadius: 5,
    },
    nodesRow: {
      ...StyleSheet.absoluteFillObject,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    dot: {
      width: DOT,
      height: DOT,
      borderRadius: DOT / 2,
      marginHorizontal: 1,
    },
    // Sits on the brand-colored fill.
    dotDone: {
      backgroundColor: 'rgba(255,255,255,0.85)',
    },
    dotTodo: {
      backgroundColor: p.subtle,
    },
    markerWrap: {
      width: MARKER,
      height: MARKER,
      alignItems: 'center',
      justifyContent: 'center',
    },
    markerPulse: {
      position: 'absolute',
      width: MARKER,
      height: MARKER,
      borderRadius: MARKER / 2,
    },
    marker: {
      width: MARKER,
      height: MARKER,
      borderRadius: MARKER / 2,
      alignItems: 'center',
      justifyContent: 'center',
    },

    labelsRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginTop: 8,
    },
    label: {
      flex: 1,
      color: p.muted,
      fontSize: 12,
      fontWeight: '600',
      textAlign: 'center',
    },
    labelStart: {
      textAlign: 'left',
    },
    labelEnd: {
      textAlign: 'right',
    },
    labelCurrent: {
      color: p.text,
    },
  });
}
