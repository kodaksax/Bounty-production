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
const H_PAD = 16;
const COL_GAP = 10;
export const GRID_CARD_WIDTH = (SCREEN_WIDTH - H_PAD * 2 - COL_GAP) / 2;

export interface BountyGridItemProps {
  id: string | number;
  title: string;
  username?: string;
  price: number;
  distance: number | null;
  description?: string;
  isForHonor?: boolean;
  user_id?: string | null;
  work_type?: 'online' | 'in_person';
  poster_avatar?: string;
  end_date?: string | null;
}

function BountyGridItemComponent({
  id,
  title,
  username,
  price,
  distance,
  description,
  isForHonor,
  user_id,
  work_type,
  poster_avatar,
  end_date,
}: BountyGridItemProps) {
  const { theme } = useAppThemeContext();
  const s = useMemo(() => makeStyles(theme), [theme]);

  const [showDetail, setShowDetail] = useState(false);
  const router = useRouter();
  const { triggerHaptic } = useHapticFeedback();
  const { profile: posterProfile, loading: profileLoading } = useNormalizedProfile(
    user_id ?? undefined
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
          {/* ── Header: avatar + username ───────────────────── */}
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
              {work_type === 'online' ? (
                <View style={s.workChip}>
                  <MaterialIcons name="wifi" size={10} color={theme.primaryLight} />
                  <Text style={s.workChipText}>Remote</Text>
                </View>
              ) : distance !== null ? (
                <Text style={s.distanceText}>{distance} mi</Text>
              ) : (
                <Text style={s.distanceText}>In Person</Text>
              )}
            </View>
          </View>

          {/* ── Countdown: only shown when the deadline is <24h away ── */}
          <CountdownBadge endDate={end_date} style={s.countdownBadge} />

          {/* ── Title ──────────────────────────────────────── */}
          <Text style={s.title} numberOfLines={3}>
            {title}
          </Text>

          {/* ── Description ────────────────────────────────── */}
          {description ? (
            <Text style={s.description} numberOfLines={2}>
              {description}
            </Text>
          ) : null}

          {/* ── Footer: price / honor + green CTA ──────────── */}
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
              <MaterialIcons name="arrow-forward" size={14} color="#fff" />
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
            description,
            user_id,
            work_type,
            poster_avatar,
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
    prev.user_id === next.user_id &&
    prev.work_type === next.work_type &&
    prev.poster_avatar === next.poster_avatar &&
    prev.end_date === next.end_date
);

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    card: {
      width: GRID_CARD_WIDTH,
      backgroundColor: t.surface,
      borderRadius: 16,
      padding: 14,
      borderWidth: 1,
      borderColor: t.border,
      borderTopWidth: 3,
      borderTopColor: '#059669',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.15,
      shadowRadius: 8,
      elevation: 5,
    },

    // Header
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 10,
    },
    avatar: {
      width: 32,
      height: 32,
      borderRadius: 16,
      borderWidth: 2,
      borderColor: t.border,
    },
    avatarFallback: {
      backgroundColor: t.surfaceSecondary,
      width: 32,
      height: 32,
      borderRadius: 16,
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
      gap: 3,
    },
    username: {
      fontSize: 11,
      fontWeight: '600',
      color: t.text,
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
    },
    countdownBadge: {
      marginBottom: 8,
    },

    // Body
    title: {
      fontSize: 13,
      fontWeight: '700',
      color: t.text,
      lineHeight: 18,
      marginBottom: 6,
    },
    description: {
      fontSize: 12,
      color: t.textSecondary,
      lineHeight: 17,
      marginBottom: 6,
    },

    // Footer
    footer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingTop: 10,
      borderTopWidth: 1,
      borderTopColor: t.surfaceSecondary,
      marginTop: 4,
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
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: '#059669',
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
}
