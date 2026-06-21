'use client';

import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Dimensions, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNormalizedProfile } from '../hooks/useNormalizedProfile';
import { SPACING } from '../lib/constants/accessibility';
import { useHapticFeedback } from '../lib/haptic-feedback';
import { useAppThemeContext } from '../lib/themes/AppThemeContext';
import type { AppTheme } from '../lib/themes/types';
import { BountyDetailModal } from './bountydetailmodal';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export interface BountyListItemProps {
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
}

function BountyListItemComponent({
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
}: BountyListItemProps) {
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

  const handleBountyPress = useCallback(() => {
    triggerHaptic('light');
    setShowDetail(true);
  }, [triggerHaptic]);

  return (
    <>
      <View style={s.page}>
        {/* Top: poster info */}
        <View style={s.posterRow}>
          <TouchableOpacity
            onPress={handleAvatarPress}
            disabled={!user_id}
            style={s.avatarWrap}
            accessibilityRole="button"
            accessibilityLabel={`View ${resolvedUsername}'s profile`}
          >
            <Avatar style={s.avatar}>
              <AvatarImage
                src={avatarUrl || '/placeholder.svg?height=48&width=48'}
                alt={resolvedUsername}
              />
              <AvatarFallback style={s.avatarFallback}>
                <Text style={s.avatarText}>{resolvedUsername.substring(0, 2).toUpperCase()}</Text>
              </AvatarFallback>
            </Avatar>
          </TouchableOpacity>
          <View>
            <Text style={s.posterName}>{resolvedUsername}</Text>
            <Text style={s.posterLabel}>posted a bounty</Text>
          </View>
          <View style={s.workTypeBadge}>
            {work_type === 'online' ? (
              <View style={s.onlineBadge}>
                <MaterialIcons name="wifi" size={12} color="#059669" />
                <Text style={s.onlineText}>Remote</Text>
              </View>
            ) : (
              <View style={s.inPersonBadge}>
                <MaterialIcons name="near-me" size={12} color="#059669" />
                <Text style={s.inPersonText}>In Person</Text>
              </View>
            )}
          </View>
        </View>

        {/* Center: main content */}
        <View style={s.mainContent}>
          <View style={s.titleRow}>
            <Text style={s.title}>{title}</Text>
            {isForHonor && (
              <View style={s.honorBadgeLarge}>
                <MaterialIcons name="favorite" size={16} color="#059669" />
                <Text style={s.honorBadgeLargeText}>For Honor</Text>
              </View>
            )}
          </View>

          {description ? (
            <Text style={s.description} numberOfLines={4}>
              {description}
            </Text>
          ) : null}

          <View style={s.locationRow}>
            <MaterialIcons
              name={work_type === 'online' ? 'wifi' : 'near-me'}
              size={14}
              color={theme.textDisabled}
            />
            <Text style={s.locationText}>
              {work_type === 'online'
                ? 'Remote work'
                : distance !== null
                  ? `${distance} miles away`
                  : 'Location TBD'}
            </Text>
          </View>
        </View>

        {/* Bottom: price + CTA */}
        <View style={s.footer}>
          <View style={s.priceBlock}>
            {isForHonor ? (
              <>
                <Text style={s.priceLabelHonor}>Reward</Text>
                <Text style={s.priceValueHonor}>Honor</Text>
              </>
            ) : (
              <>
                <Text style={s.priceLabelHonor}>Bounty</Text>
                <Text style={s.priceValue}>${price}</Text>
              </>
            )}
          </View>
          <TouchableOpacity
            style={s.applyButton}
            onPress={handleBountyPress}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={`Apply to bounty: ${title}`}
          >
            <Text style={s.applyButtonText}>View & Apply</Text>
            <MaterialIcons name="arrow-forward" size={18} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>

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

export const BountyListItem = React.memo(
  BountyListItemComponent,
  (prev, next) =>
    prev.id === next.id &&
    prev.title === next.title &&
    prev.username === next.username &&
    prev.price === next.price &&
    prev.distance === next.distance &&
    prev.description === next.description &&
    prev.isForHonor === next.isForHonor &&
    prev.user_id === next.user_id &&
    prev.work_type === next.work_type &&
    prev.poster_avatar === next.poster_avatar
);

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    page: {
      flex: 1,
      backgroundColor: t.background,
      paddingHorizontal: SPACING.SCREEN_HORIZONTAL,
      paddingVertical: 24,
      paddingBottom: 120,
      justifyContent: 'space-between',
    },

    // Poster row
    posterRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      marginTop: 8,
    },
    avatarWrap: {},
    avatar: {
      width: 48,
      height: 48,
      borderRadius: 24,
      borderWidth: 2,
      borderColor: t.primary,
    },
    avatarFallback: {
      backgroundColor: t.surfaceSecondary,
      justifyContent: 'center',
      alignItems: 'center',
      width: 48,
      height: 48,
      borderRadius: 24,
      borderWidth: 1,
      borderColor: t.border,
    },
    avatarText: {
      fontSize: 14,
      fontWeight: '700',
      color: t.primaryLight,
    },
    posterName: {
      fontSize: 15,
      fontWeight: '700',
      color: t.text,
    },
    posterLabel: {
      fontSize: 12,
      color: t.textSecondary,
      marginTop: 1,
    },
    workTypeBadge: {
      marginLeft: 'auto',
    },
    // Online / in-person badges keep semantic colors; only bg/border adapt
    onlineBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: t.isDark ? 'rgba(16,185,129,0.1)' : 'rgba(5,150,105,0.08)',
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: t.isDark ? 'rgba(16,185,129,0.3)' : 'rgba(5,150,105,0.25)',
    },
    onlineText: {
      fontSize: 12,
      fontWeight: '600',
      color: t.primary,
    },
    inPersonBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: t.isDark ? 'rgba(16,185,129,0.1)' : 'rgba(5,150,105,0.08)',
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: t.isDark ? 'rgba(16,185,129,0.3)' : 'rgba(5,150,105,0.25)',
    },
    inPersonText: {
      fontSize: 12,
      fontWeight: '600',
      color: t.primary,
    },

    // Main content
    mainContent: {
      gap: 12,
      marginTop: 16,
    },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 12,
    },
    honorBadgeLarge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: t.isDark ? 'rgba(16,185,129,0.12)' : 'rgba(5,150,105,0.08)',
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 20,
      alignSelf: 'flex-start',
      borderWidth: 1,
      borderColor: t.isDark ? 'rgba(16,185,129,0.3)' : 'rgba(5,150,105,0.25)',
    },
    honorBadgeLargeText: {
      color: t.primary,
      fontWeight: '700',
      fontSize: 13,
    },
    title: {
      fontSize: 28,
      fontWeight: '800',
      color: t.text,
      letterSpacing: -0.5,
      lineHeight: 34,
      flex: 1,
    },
    description: {
      fontSize: 15,
      color: t.textSecondary,
      lineHeight: 22,
    },
    locationRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    locationText: {
      fontSize: 13,
      color: t.textDisabled,
      fontWeight: '500',
    },

    // Footer
    footer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: t.surface,
      borderRadius: 20,
      padding: 16,
      borderWidth: 1,
      borderColor: t.border,
      shadowColor: '#000',
      shadowOpacity: t.isDark ? 0.4 : 0.08,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
      elevation: 4,
    },
    priceBlock: {
      gap: 2,
    },
    priceLabel: {
      fontSize: 11,
      fontWeight: '600',
      color: t.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    priceValue: {
      fontSize: 26,
      fontWeight: '800',
      color: t.primary,
    },
    priceLabelHonor: {
      fontSize: 11,
      fontWeight: '800',
      color: t.primary,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    priceValueHonor: {
      fontSize: 16,
      fontWeight: '700',
      color: t.primary,
    },
    applyButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: t.primary,
      paddingHorizontal: 20,
      paddingVertical: 14,
      borderRadius: 14,
      shadowColor: t.primary,
      shadowOpacity: 0.3,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
      elevation: 4,
    },
    applyButtonText: {
      color: '#ffffff',
      fontWeight: '700',
      fontSize: 15,
    },
  });
}
