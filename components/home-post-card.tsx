import { MaterialIcons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { SIZING, SPACING, TYPOGRAPHY } from '../lib/constants/accessibility';
import type { HomePostCardAction, PrimaryRole } from '../lib/home/home-post-card';
import { analyticsService } from '../lib/services/analytics-service';
import { useAppThemeContext } from '../lib/themes/AppThemeContext';
import type { AppTheme } from '../lib/themes/types';

// At or above this width (tablets, wide windows) the button and the links sit
// side by side, so the card spans the screen instead of stacking a very wide
// button over two lines of text.
const WIDE_LAYOUT_MIN_WIDTH = 768;

export interface HomePostCardProps {
  onPostNew: () => void;
  /**
   * "Post again: <title>" for the poster's most recent bounty. Leave unset to
   * hide the row: it stays hidden until the Post-again flow (P3) exists.
   */
  postAgain?: { bountyId: string; title: string; onPress: () => void } | null;
  onSeeAllPosts: () => void;
  /**
   * True once Home is the on-screen tab and the card's content has settled
   * (the latest-bounty lookup finished). home_post_card_shown waits for it, so
   * a card loaded off-screen, or before "Post again" is known, isn't counted.
   */
  impressionReady: boolean;
  primaryRole: PrimaryRole;
  hasPosted: boolean;
  /** The feed layout ('card' | 'compact' | 'grid'), for analytics. */
  layout: string;
  /**
   * Horizontal screen gutter. The grid layout renders the card inside a list
   * header that already has one, so it passes false.
   */
  inset?: boolean;
}

/**
 * The first thing a returning poster sees on Home: a large "Post a job"
 * button, "Post again" for their last bounty, and a way to their posts.
 * Rendered by BountyFeed above the hunter feed; see
 * lib/home/home-post-card.ts for who gets it.
 */
export function HomePostCard({
  onPostNew,
  postAgain,
  onSeeAllPosts,
  impressionReady,
  primaryRole,
  hasPosted,
  layout,
  inset = true,
}: HomePostCardProps) {
  const { theme } = useAppThemeContext();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const { width } = useWindowDimensions();
  const wide = width >= WIDE_LAYOUT_MIN_WIDTH;

  const base = {
    surface: 'home_feed',
    role: 'poster',
    primary_role: primaryRole ?? null,
    has_posted: hasPosted,
    post_again_available: !!postAgain,
    layout,
  };
  const baseRef = useRef(base);
  baseRef.current = base;

  // Once per mount. The feed stays mounted for the whole session, so this is
  // one impression per app session, not one per visit to Home.
  const shownRef = useRef(false);
  useEffect(() => {
    if (!impressionReady || shownRef.current) return;
    shownRef.current = true;
    analyticsService.trackEvent('home_post_card_shown', baseRef.current);
  }, [impressionReady]);

  const tap = (action: HomePostCardAction, run: () => void, bountyId?: string) => () => {
    analyticsService.trackEvent('home_post_card_tapped', {
      ...baseRef.current,
      action,
      ...(bountyId ? { bounty_id: bountyId } : {}),
    });
    run();
  };

  const againTitle = postAgain?.title || 'your last job';

  return (
    <View style={[s.card, inset && s.cardInset, wide && s.cardWide]} testID="home-post-card">
      <TouchableOpacity
        style={[s.primaryButton, wide && s.primaryButtonWide]}
        onPress={tap('post_new', onPostNew)}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel="Post a job"
        accessibilityHint="Opens the form to post a new job"
        testID="home-post-card-post-new"
      >
        <MaterialIcons name="add-circle-outline" size={24} color="#ffffff" />
        <Text style={s.primaryLabel} maxFontSizeMultiplier={1.4} numberOfLines={1}>
          Post a job
        </Text>
      </TouchableOpacity>

      <View style={[s.links, wide && s.linksWide]}>
        {postAgain ? (
          <TouchableOpacity
            style={s.againRow}
            onPress={tap('post_again', postAgain.onPress, postAgain.bountyId)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`Post again: ${againTitle}`}
            accessibilityHint="Starts a new job from this one"
            testID="home-post-card-post-again"
          >
            <MaterialIcons name="replay" size={20} color={theme.primary} />
            <Text style={s.againText} numberOfLines={1} maxFontSizeMultiplier={1.4}>
              <Text style={s.againLead}>Post again: </Text>
              {againTitle}
            </Text>
            <MaterialIcons name="chevron-right" size={20} color={theme.textSecondary} />
          </TouchableOpacity>
        ) : null}

        <TouchableOpacity
          style={s.seeAll}
          onPress={tap('see_all_posts', onSeeAllPosts)}
          activeOpacity={0.7}
          accessibilityRole="link"
          accessibilityLabel="See all my posts"
          testID="home-post-card-see-all"
        >
          <Text style={s.seeAllText} maxFontSizeMultiplier={1.4}>
            See all my posts
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    card: {
      marginTop: SPACING.COMPACT_GAP,
      padding: 12,
      borderRadius: 16,
      backgroundColor: t.surface,
      borderWidth: StyleSheet.hairlineWidth * 2,
      borderColor: t.border,
      gap: SPACING.COMPACT_GAP,
    },
    cardInset: {
      marginHorizontal: SPACING.SCREEN_HORIZONTAL,
    },
    cardWide: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 16,
    },
    primaryButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      minHeight: 56,
      paddingHorizontal: 20,
      borderRadius: 14,
      backgroundColor: t.primary,
      borderBottomWidth: 3,
      borderBottomColor: t.primaryShade,
    },
    primaryButtonWide: {
      flex: 1,
    },
    primaryLabel: {
      color: '#ffffff',
      fontSize: TYPOGRAPHY.SIZE_LARGE,
      fontWeight: '800',
      letterSpacing: -0.2,
    },
    links: {
      gap: 2,
    },
    linksWide: {
      flex: 1,
    },
    againRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      minHeight: SIZING.MIN_TOUCH_TARGET,
      paddingHorizontal: 8,
      borderRadius: 10,
      backgroundColor: t.surfaceSecondary,
    },
    againText: {
      flex: 1,
      color: t.text,
      fontSize: TYPOGRAPHY.SIZE_SMALL,
    },
    againLead: {
      fontWeight: '700',
    },
    seeAll: {
      alignSelf: 'center',
      justifyContent: 'center',
      minHeight: SIZING.MIN_TOUCH_TARGET,
      paddingHorizontal: 12,
    },
    seeAllText: {
      color: t.primary,
      fontSize: TYPOGRAPHY.SIZE_SMALL,
      fontWeight: '700',
    },
  });
}
