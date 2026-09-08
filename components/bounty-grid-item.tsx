'use client';

import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Dimensions, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNormalizedProfile } from '../hooks/useNormalizedProfile';
import { useHapticFeedback } from '../lib/haptic-feedback';
import { useAppThemeContext } from '../lib/themes/AppThemeContext';
import type { AppTheme } from '../lib/themes/types';
import { BountyDetailModal } from './bountydetailmodal';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { CountdownBadge } from './ui/countdown-badge';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
// Must match the grid feed's screen padding (SPACING.SCREEN_HORIZONTAL) and the
// implicit gap the pair row's space-between leaves between the two columns.
const H_PAD = 16;
const COL_GAP = 10;
export const GRID_CARD_WIDTH = (SCREEN_WIDTH - H_PAD * 2 - COL_GAP) / 2;

// Every gap / pad / box dimension inside the card is a fraction of the card's
// own width (itself derived from the device width above), so the card's
// internal rhythm scales with the screen instead of being pinned to fixed px.
// This is also what keeps spacing identical across cards: the footer is placed
// by `content: flex 1`, not by how much meta a given bounty happens to have.
const CW = GRID_CARD_WIDTH;
const SPACE = {
  pad: Math.round(CW * 0.082), // outer card padding
  gapTight: Math.round(CW * 0.018), // inside a text group (username ↔ meta line)
  gapRow: Math.round(CW * 0.034), // between stacked body rows
  gapBlock: Math.round(CW * 0.055), // header ↔ body, and body ↔ footer divider
};
const AVATAR = Math.round(CW * 0.185);
const DOT = Math.round(CW * 0.035);

export interface BountyGridItemProps {
  id: string | number;
  title: string;
  username?: string;
  price: number;
  distance: number | null;
  location?: string | null;
  description?: string;
  isForHonor?: boolean;
  user_id?: string | null;
  work_type?: 'online' | 'in_person';
  poster_avatar?: string | null;
  end_date?: string | null;
  /** Category accent (same palette as the featured carousel cards). */
  categoryColor?: string;
  categoryLabel?: string;
  /** Listing is missing scope / location / timing. See
   * lib/utils/bounty-completeness.ts. */
  incomplete?: boolean;
  missingSummary?: string;
}

function BountyGridItemComponent({
  id,
  title,
  username,
  price,
  distance,
  location,
  description,
  isForHonor,
  user_id,
  work_type,
  poster_avatar,
  end_date,
  categoryColor,
  categoryLabel,
  incomplete,
  missingSummary,
}: BountyGridItemProps) {
  const { theme } = useAppThemeContext();
  const s = useMemo(() => makeStyles(theme), [theme]);

  const [showDetail, setShowDetail] = useState(false);
  const router = useRouter();
  const { triggerHaptic } = useHapticFeedback();
  const hasJoinedPosterIdentity = typeof username === 'string' && poster_avatar !== undefined;
  const { profile: posterProfile, loading: profileLoading } = useNormalizedProfile(
    user_id ?? undefined,
    // Skip the Supabase profile lookup when the bounty row already carries
    // both username and avatar state from the feed JOIN, including null avatars.
    { enabled: !hasJoinedPosterIdentity }
  );
  const [resolvedUsername, setResolvedUsername] = useState<string>(username || 'Loading...');
  const avatarUrl = poster_avatar || posterProfile?.avatar;

  useEffect(() => {
    if (username) {
      setResolvedUsername(username);
      return;
    }
    if (posterProfile?.username) {
      setResolvedUsername(posterProfile.username);
      return;
    }
    setResolvedUsername(profileLoading ? 'Loading...' : 'Anonymous');
  }, [username, posterProfile?.username, profileLoading]);

  const handleAvatarPress = useCallback(
    (e: any) => {
      e.stopPropagation();
      triggerHaptic('light');
      if (user_id) router.push(`/profile/${user_id}`);
    },
    [user_id, router, triggerHaptic]
  );

  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePressIn = useCallback(() => {
    Animated.spring(scaleAnim, {
      toValue: 1.04,
      useNativeDriver: true,
      speed: 24,
      bounciness: 5,
    }).start();
  }, [scaleAnim]);

  const handlePressOut = useCallback(() => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
      speed: 24,
      bounciness: 5,
    }).start();
  }, [scaleAnim]);

  const handlePress = useCallback(() => {
    triggerHaptic('light');
    setShowDetail(true);
  }, [triggerHaptic]);

  return (
    <>
      <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
        <TouchableOpacity
          activeOpacity={0.8}
          style={s.card}
          onPress={handlePress}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          accessibilityRole="button"
          accessibilityLabel={`${title} by ${resolvedUsername}${isForHonor ? ', for honor' : `, $${price}`}`}
          accessibilityHint="Tap to view bounty details"
        >
          {/* ── Top content: fills the square, clipped so it never pushes
                the footer out of the fixed-height card ───────────────── */}
          <View style={s.content}>
            {/* Header: avatar + username */}
            <View style={s.header}>
              <TouchableOpacity
                onPress={handleAvatarPress}
                disabled={!user_id}
                accessibilityRole="button"
                accessibilityLabel={`View ${resolvedUsername}'s profile`}
              >
                <Avatar style={s.avatar}>
                  <AvatarImage
                    src={avatarUrl || '/placeholder.svg?height=32&width=32'}
                    alt={resolvedUsername}
                  />
                  <AvatarFallback style={s.avatarFallback}>
                    <Text style={s.avatarText}>{resolvedUsername.substring(0, 2).toUpperCase()}</Text>
                  </AvatarFallback>
                </Avatar>
              </TouchableOpacity>
              <View style={s.headerMeta}>
                <Text style={s.username} numberOfLines={1}>
                  {resolvedUsername}
                </Text>
                <View style={s.metaLine}>
                  {categoryColor && (
                    <View
                      style={[s.categoryDot, { backgroundColor: categoryColor }]}
                      accessibilityLabel={categoryLabel ? `Category: ${categoryLabel}` : undefined}
                    />
                  )}
                  {work_type === 'online' ? (
                    <View style={s.workChip}>
                      <MaterialIcons name="wifi" size={10} color={theme.primaryLight} />
                      <Text style={s.workChipText}>Remote</Text>
                    </View>
                  ) : location ? (
                    <Text style={s.distanceText} numberOfLines={1}>{location}</Text>
                  ) : distance !== null ? (
                    <Text style={s.distanceText}>{distance} mi</Text>
                  ) : (
                    <Text style={s.distanceText}>In Person</Text>
                  )}
                </View>
              </View>
            </View>

            {/* Countdown: only shown when the deadline is <24h away */}
            <CountdownBadge endDate={end_date} style={s.countdownBadge} />

            {/* Title */}
            <Text style={s.title} numberOfLines={2}>
              {title}
            </Text>

            {/* Description — suppressed on incomplete cards: the "Limited
                details" badge below already tells the hunter what's missing,
                and dropping it keeps the clipped content box from eating the
                title on a dense card. */}
            {description && !incomplete ? (
              <Text style={s.description} numberOfLines={1}>
                {description}
              </Text>
            ) : null}
          </View>

          {/* Limited-details badge — a sibling of the footer, NOT inside the
              clipped content box, so this logistics warning is always visible
              in full even when the body has to clip. */}
          {incomplete ? (
            <View style={s.limitedBadge}>
              <MaterialIcons
                name="info-outline"
                size={11}
                color={theme.isDark ? theme.warning : theme.textSecondary}
              />
              <Text style={s.limitedText} numberOfLines={1}>
                {missingSummary || 'Limited details'}
              </Text>
            </View>
          ) : null}

          {/* ── Footer: price / honor + View button ─────────── */}
          <View style={s.footer}>
            {isForHonor ? (
              <View style={s.honorBadge}>
                <MaterialIcons name="favorite" size={12} color="#059669" />
                <Text style={s.honorText}>For Honor</Text>
              </View>
            ) : (
              <Text style={s.amount}>${price}</Text>
            )}
            <View style={s.viewBtn}>
              <Text style={s.viewBtnText}>View</Text>
            </View>
          </View>
        </TouchableOpacity>
      </Animated.View>

      {showDetail && (
        <BountyDetailModal
          bounty={{
            id,
            username: resolvedUsername,
            title,
            price,
            distance,
            location: location ?? undefined,
            description,
            user_id,
            work_type,
            poster_avatar: poster_avatar ?? undefined,
            is_for_honor: isForHonor,
          }}
          onClose={() => setShowDetail(false)}
        />
      )}
    </>
  );
}

export const BountyGridItem = React.memo(
  BountyGridItemComponent,
  (prev, next) =>
    prev.id === next.id &&
    prev.title === next.title &&
    prev.price === next.price &&
    prev.distance === next.distance &&
    prev.location === next.location &&
    prev.user_id === next.user_id &&
    prev.work_type === next.work_type &&
    prev.poster_avatar === next.poster_avatar &&
    prev.end_date === next.end_date &&
    prev.categoryColor === next.categoryColor &&
    prev.incomplete === next.incomplete &&
    prev.missingSummary === next.missingSummary
);

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    card: {
      width: GRID_CARD_WIDTH,
      aspectRatio: 1,
      overflow: 'hidden',
      backgroundColor: t.surface,
      borderRadius: 16,
      padding: SPACE.pad,
      borderWidth: 1,
      borderColor: t.border,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.15,
      shadowRadius: 8,
      elevation: 5,
    },
    // flex 1 (not flexShrink) so the body always occupies the full space above
    // the footer — the footer lands at the same Y on every card regardless of
    // how much meta a bounty has. overflow hidden so a content-heavy card
    // clips its own body instead of bleeding text down onto the price.
    content: {
      flex: 1,
      overflow: 'hidden',
      paddingBottom: SPACE.gapRow,
    },

    // Header
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACE.gapRow,
      marginBottom: SPACE.gapBlock,
    },
    avatar: {
      width: AVATAR,
      height: AVATAR,
      borderRadius: AVATAR / 2,
      borderWidth: 2,
      borderColor: t.border,
    },
    avatarFallback: {
      backgroundColor: t.surfaceSecondary,
      width: AVATAR,
      height: AVATAR,
      borderRadius: AVATAR / 2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarText: {
      fontSize: 11,
      fontWeight: '800',
      color: t.text,
    },
    headerMeta: {
      flex: 1,
      gap: SPACE.gapTight,
    },
    username: {
      fontSize: 11,
      fontWeight: '600',
      color: t.text,
    },
    metaLine: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACE.gapTight,
    },
    categoryDot: {
      width: DOT,
      height: DOT,
      borderRadius: DOT / 2,
    },
    workChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
    },
    workChipText: {
      fontSize: 10,
      color: t.textSecondary,
    },
    distanceText: {
      fontSize: 10,
      color: t.textSecondary,
      flexShrink: 1,
    },
    countdownBadge: {
      marginBottom: SPACE.gapRow,
    },

    // Body
    title: {
      fontSize: 13,
      fontWeight: '700',
      color: t.text,
      lineHeight: 18,
      marginBottom: SPACE.gapTight,
    },
    description: {
      fontSize: 12,
      color: t.textSecondary,
      lineHeight: 17,
      marginBottom: SPACE.gapTight,
    },
    limitedBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: SPACE.gapTight,
      paddingHorizontal: SPACE.gapRow,
      paddingVertical: SPACE.gapTight,
      borderRadius: 999,
      // Dark mode: a crisp outlined amber chip rather than a low-alpha fill,
      // which over the dark surface just muddied into an opaque brown block
      // and let the grey text disappear.
      backgroundColor: t.isDark ? 'transparent' : 'rgba(245,158,11,0.12)',
      borderWidth: 1,
      borderColor: t.isDark ? t.warning : 'rgba(245,158,11,0.28)',
      marginBottom: SPACE.gapRow,
    },
    limitedText: {
      fontSize: 10,
      fontWeight: t.isDark ? '700' : '600',
      color: t.isDark ? t.warning : t.textSecondary,
      flexShrink: 1,
    },

    // Footer — pinned to the bottom by `content: flex 1`, so its top edge is at
    // an identical Y on every card. The gap above the divider is owned by
    // `content.paddingBottom`, so a clipped body can't crowd the price.
    footer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingTop: SPACE.gapBlock,
      borderTopWidth: 1,
      borderTopColor: t.surfaceSecondary,
    },
    amount: {
      fontSize: 18,
      fontWeight: '800',
      color: t.primary,
    },
    honorBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: t.isDark ? 'rgba(16,185,129,0.15)' : 'rgba(5,150,105,0.1)',
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderWidth: 1,
      borderColor: t.isDark ? 'rgba(16,185,129,0.35)' : 'rgba(5,150,105,0.3)',
      gap: 4,
    },
    honorText: {
      color: t.primary,
      fontWeight: '800',
      fontSize: 11,
    },
    viewBtn: {
      paddingHorizontal: 14,
      paddingVertical: 7,
      borderRadius: 10,
      backgroundColor: t.text,
      alignItems: 'center',
      justifyContent: 'center',
    },
    viewBtnText: {
      fontSize: 12,
      fontWeight: '700',
      color: t.background,
      letterSpacing: 0.2,
    },
  });
}
