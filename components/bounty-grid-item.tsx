'use client';

import { MaterialIcons } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Dimensions, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNormalizedProfile } from '../hooks/useNormalizedProfile';
import { useCountdown } from '../hooks/useCountdown';
import { useHapticFeedback } from '../lib/haptic-feedback';
import type { AttachmentMeta } from '../lib/services/database.types';
import { useAppThemeContext } from '../lib/themes/AppThemeContext';
import type { AppTheme } from '../lib/themes/types';
import { getScheduleChip } from '../lib/utils/schedule-utils';
import { BountyDetailModal } from './bountydetailmodal';
import { CountdownBadge } from './ui/countdown-badge';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
// Must match the grid feed's screen padding (SPACING.SCREEN_HORIZONTAL) and the
// implicit gap the pair row's space-between leaves between the two columns.
const H_PAD = 16;
const COL_GAP = 10;
export const GRID_CARD_WIDTH = (SCREEN_WIDTH - H_PAD * 2 - COL_GAP) / 2;

// Same anatomy as the featured carousel card (bounty-featured-item.tsx): a
// cover with its chips overlaid, then an info block of fixed-height slots with
// the price row pinned to the bottom. Only the scale differs — this card keeps
// its existing square, two-per-row footprint, so every box below is a fraction
// of the card's own width rather than a copy of the featured card's pixels.
//
// Fixed slots are what make the format hold: a one-line title, a missing
// description or an incomplete listing changes what's in a slot, never where
// the slots are, so titles and prices line up across both columns.
const CW = GRID_CARD_WIDTH;
const COVER_HEIGHT = Math.round(CW * 0.42);
const INFO_PADDING = Math.round(CW * 0.058);
const TITLE_LINE_HEIGHT = Math.round(CW * 0.085);
/** Two lines, reserved whether the title wraps or not. */
const TITLE_HEIGHT = TITLE_LINE_HEIGHT * 2;
const DESCRIPTION_HEIGHT = Math.round(CW * 0.075);
const LOCATION_HEIGHT = Math.round(CW * 0.065);
const META_HEIGHT = Math.round(CW * 0.105);
/** Gaps between the text slots; the gap above the meta row is elastic. */
const SLOT_GAP = Math.max(2, Math.round(CW * 0.012));

const FONT = {
  title: Math.round(CW * 0.072),
  description: Math.round(CW * 0.06),
  location: Math.round(CW * 0.055),
  price: Math.round(CW * 0.085),
  username: Math.round(CW * 0.06),
  chip: Math.round(CW * 0.055),
};

// Fixed-height text slots only hold if the text can't grow without bound.
// Matches the cap on the featured card.
const CARD_MAX_FONT_SCALE = 1.2;

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
  /** Cover image source — same first-image-wins rule as the featured card. */
  attachments_json?: string;
  // Schedule fields, for the chip overlaid on the cover.
  schedule_type?: 'asap' | 'scheduled' | 'flexible' | null;
  start_date?: string | null;
  duration_minutes?: number | null;
  is_time_sensitive?: boolean;
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
  attachments_json,
  schedule_type,
  start_date,
  duration_minutes,
  is_time_sensitive,
  categoryColor,
  categoryLabel,
  incomplete,
  missingSummary,
}: BountyGridItemProps) {
  const { theme } = useAppThemeContext();
  const s = useMemo(() => makeStyles(theme), [theme]);

  const [showDetail, setShowDetail] = useState(false);
  const { triggerHaptic } = useHapticFeedback();
  const hasJoinedPosterIdentity = typeof username === 'string' && poster_avatar !== undefined;
  const { profile: posterProfile, loading: profileLoading } = useNormalizedProfile(
    user_id ?? undefined,
    // Skip the Supabase profile lookup when the bounty row already carries
    // both username and avatar state from the feed JOIN, including null avatars.
    { enabled: !hasJoinedPosterIdentity }
  );
  const [resolvedUsername, setResolvedUsername] = useState<string>(username || 'Loading...');

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

  const firstImageUri = useMemo(() => {
    if (!attachments_json) return null;
    try {
      const attachments: AttachmentMeta[] = JSON.parse(attachments_json);
      const found = attachments.find(a => a.remoteUri && a.mimeType?.startsWith('image/'));
      return found?.remoteUri ?? null;
    } catch {
      return null;
    }
  }, [attachments_json]);

  const scheduleChip = useMemo(() => {
    if (schedule_type) {
      return getScheduleChip(schedule_type, start_date, end_date, duration_minutes);
    }
    if (is_time_sensitive) {
      return { label: 'URGENT', icon: '🔴', variant: 'urgent' as const };
    }
    return null;
  }, [schedule_type, start_date, end_date, duration_minutes, is_time_sensitive]);

  // Under 24h to the deadline, a live countdown takes the chip's place.
  const { isWithin24h: showCountdown } = useCountdown(end_date);

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
          {/* Cover — image or category gradient placeholder */}
          {firstImageUri ? (
            <ExpoImage
              source={{ uri: firstImageUri }}
              style={s.cover}
              contentFit="cover"
              recyclingKey={firstImageUri}
            />
          ) : (
            <LinearGradient
              colors={[
                (categoryColor || theme.primary) + 'cc',
                (categoryColor || theme.primary) + '66',
                '#064e3b',
              ]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={s.cover}
            >
              <MaterialIcons
                name="work-outline"
                size={Math.round(CW * 0.15)}
                color="rgba(255,255,255,0.25)"
              />
            </LinearGradient>
          )}

          {/* "Limited details" rides the cover rather than the info block: in
              the flow below it would push the title, description and price
              down on exactly the cards that have it. */}
          {incomplete ? (
            <View style={s.limitedBadge}>
              <MaterialIcons name="info-outline" size={10} color="rgba(255,255,255,0.85)" />
              <Text
                style={s.limitedText}
                numberOfLines={1}
                maxFontSizeMultiplier={CARD_MAX_FONT_SCALE}
              >
                {missingSummary || 'Limited details'}
              </Text>
            </View>
          ) : null}

          {/* Category chip overlaid on the cover's bottom-left */}
          {categoryLabel ? (
            <View style={[s.coverChip, { backgroundColor: categoryColor || theme.primary }]}>
              <Text
                style={s.coverChipText}
                numberOfLines={1}
                maxFontSizeMultiplier={CARD_MAX_FONT_SCALE}
              >
                {categoryLabel}
              </Text>
            </View>
          ) : null}

          {/* Schedule chip overlaid top-right — a live countdown takes over
              once the deadline is under 24h away. */}
          {showCountdown ? (
            <CountdownBadge
              endDate={end_date}
              size="sm"
              style={[s.scheduleChip, s.scheduleChipUrgent]}
            />
          ) : (
            scheduleChip && (
              <View
                style={[
                  s.scheduleChip,
                  scheduleChip.variant === 'urgent' && s.scheduleChipUrgent,
                  scheduleChip.variant === 'warning' && s.scheduleChipWarning,
                ]}
              >
                <Text
                  style={s.scheduleChipText}
                  numberOfLines={1}
                  maxFontSizeMultiplier={CARD_MAX_FONT_SCALE}
                >
                  {scheduleChip.icon} {scheduleChip.label}
                </Text>
              </View>
            )
          )}

          {/* Info below cover — each slot keeps its height whether or not it
              has content; the description renders as an empty line rather
              than collapsing. */}
          <View style={s.info}>
            <Text style={s.title} numberOfLines={2} maxFontSizeMultiplier={CARD_MAX_FONT_SCALE}>
              {title}
            </Text>
            <Text
              style={s.description}
              numberOfLines={1}
              maxFontSizeMultiplier={CARD_MAX_FONT_SCALE}
            >
              {description || ''}
            </Text>
            <Text
              style={s.location}
              numberOfLines={1}
              maxFontSizeMultiplier={CARD_MAX_FONT_SCALE}
            >
              {work_type === 'online'
                ? 'Remote'
                : location || (distance !== null ? `${distance} mi` : 'In Person')}
            </Text>
            <View style={s.metaRow}>
              {isForHonor ? (
                <View style={s.honorBadge}>
                  <MaterialIcons name="favorite" size={10} color={theme.primary} />
                  <Text style={s.honorText} maxFontSizeMultiplier={CARD_MAX_FONT_SCALE}>
                    For Honor
                  </Text>
                </View>
              ) : (
                <Text style={s.amount} maxFontSizeMultiplier={CARD_MAX_FONT_SCALE}>
                  ${price}
                </Text>
              )}
              <Text
                style={s.username}
                numberOfLines={1}
                maxFontSizeMultiplier={CARD_MAX_FONT_SCALE}
              >
                @{resolvedUsername}
              </Text>
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
      // Unchanged: the square, two-per-row footprint the grid places today.
      aspectRatio: 1,
      overflow: 'hidden',
      backgroundColor: t.surface,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: t.border,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.15,
      shadowRadius: 8,
      elevation: 5,
    },

    // ── Cover ────────────────────────────────────────────────────────────
    cover: {
      width: '100%',
      height: COVER_HEIGHT,
      alignItems: 'center',
      justifyContent: 'center',
    },
    coverChip: {
      position: 'absolute',
      top: COVER_HEIGHT - Math.round(CW * 0.12),
      left: Math.round(CW * 0.045),
      maxWidth: '60%',
      paddingHorizontal: Math.round(CW * 0.04),
      paddingVertical: 2,
      borderRadius: 20,
    },
    coverChipText: {
      fontSize: FONT.chip,
      fontWeight: '700',
      color: '#fff',
    },
    scheduleChip: {
      position: 'absolute',
      top: Math.round(CW * 0.04),
      right: Math.round(CW * 0.04),
      maxWidth: '55%',
      paddingHorizontal: Math.round(CW * 0.035),
      paddingVertical: 2,
      borderRadius: 10,
      backgroundColor: 'rgba(0,0,0,0.55)',
    },
    scheduleChipUrgent: {
      backgroundColor: 'rgba(220,38,38,0.85)',
    },
    scheduleChipWarning: {
      backgroundColor: 'rgba(180,100,0,0.85)',
    },
    scheduleChipText: {
      fontSize: FONT.chip,
      fontWeight: '700',
      color: '#fff',
    },
    limitedBadge: {
      position: 'absolute',
      top: Math.round(CW * 0.04),
      left: Math.round(CW * 0.04),
      // Leaves the opposite corner to the schedule chip / countdown.
      maxWidth: '55%',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      paddingHorizontal: Math.round(CW * 0.035),
      paddingVertical: 2,
      borderRadius: 999,
      backgroundColor: 'rgba(0,0,0,0.55)',
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.28)',
    },
    limitedText: {
      fontSize: FONT.chip,
      fontWeight: '700',
      color: 'rgba(255,255,255,0.9)',
      flexShrink: 1,
    },

    // ── Info ─────────────────────────────────────────────────────────────
    // flex:1 rather than a height: the card is square and the cover is fixed,
    // so this takes the remainder and any rounding lands in the elastic gap
    // above metaRow.
    info: {
      flex: 1,
      padding: INFO_PADDING,
      backgroundColor: t.surface,
    },
    title: {
      fontSize: FONT.title,
      fontWeight: '800',
      color: t.text,
      lineHeight: TITLE_LINE_HEIGHT,
      height: TITLE_HEIGHT,
      letterSpacing: -0.2,
    },
    description: {
      fontSize: FONT.description,
      color: t.textSecondary,
      lineHeight: DESCRIPTION_HEIGHT,
      height: DESCRIPTION_HEIGHT,
      marginTop: SLOT_GAP,
    },
    location: {
      fontSize: FONT.location,
      color: t.textDisabled,
      lineHeight: LOCATION_HEIGHT,
      height: LOCATION_HEIGHT,
      marginTop: SLOT_GAP,
    },
    metaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      height: META_HEIGHT,
      // Pinned to the bottom of the info block, so the price sits on the same
      // line on every card no matter what the slots above hold.
      marginTop: 'auto',
    },
    amount: {
      fontSize: FONT.price,
      lineHeight: META_HEIGHT,
      fontWeight: '800',
      color: t.primary,
    },
    honorBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: t.isDark ? 'rgba(16,185,129,0.15)' : 'rgba(5,150,105,0.1)',
      borderRadius: 999,
      paddingHorizontal: Math.round(CW * 0.04),
      paddingVertical: 2,
      borderWidth: 1,
      borderColor: t.isDark ? 'rgba(16,185,129,0.35)' : 'rgba(5,150,105,0.3)',
      gap: 3,
    },
    honorText: {
      color: t.primary,
      fontWeight: '800',
      fontSize: FONT.chip,
    },
    username: {
      fontSize: FONT.username,
      color: t.textSecondary,
      flexShrink: 1,
      marginLeft: 6,
      textAlign: 'right',
    },
  });
}
