"use client"

import { MaterialIcons } from "@expo/vector-icons"
import { useRouter } from 'expo-router'
import React, { useCallback, useEffect, useMemo, useState } from "react"
import { StyleSheet, Text, TouchableOpacity, View } from "react-native"
import type { StyleProp, ViewStyle } from "react-native"
import { useNormalizedProfile } from '../hooks/useNormalizedProfile'
import { SIZING, SPACING, TYPOGRAPHY, getLineHeight } from '../lib/constants/accessibility'
import { useHapticFeedback } from '../lib/haptic-feedback'
import { useAppThemeContext } from '../lib/themes/AppThemeContext'
import type { AppTheme } from '../lib/themes/types'
import { BountyDetailModal } from "./bountydetailmodal"
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar'

export interface BountyCompactItemProps {
  id: string | number
  title: string
  username?: string
  price: number
  distance: number | null
  location?: string | null
  description?: string
  isForHonor?: boolean
  user_id?: string | null
  work_type?: 'online' | 'in_person'
  poster_avatar?: string | null
  /** Listing is missing scope / location / timing. See
   * lib/utils/bounty-completeness.ts. */
  incomplete?: boolean
  missingSummary?: string
  /** Optional attribution line, e.g. who completed the work and when. */
  dateLabel?: string
  /** Proof this work went well — the poster's star rating and review of it,
   * plus a short standing note (e.g. a repeat client). Rendered only with
   * `dateLabel`, in the footer of the taller history card. */
  credibility?: {
    score?: number | null
    quote?: string | null
    note?: string | null
  }
  /** Override the card container — e.g. a carousel giving every card the same
   * height. Pass a stable (StyleSheet or memoized) value so memo still holds. */
  style?: StyleProp<ViewStyle>
}

function BountyCompactItemComponent({
  id, title, username, price, distance, location, description,
  isForHonor, user_id, work_type, poster_avatar, incomplete, missingSummary,
  dateLabel, credibility, style
}: BountyCompactItemProps) {
  const { theme } = useAppThemeContext()
  const s = useMemo(() => makeStyles(theme), [theme])

  const [showDetail, setShowDetail] = useState(false)
  const router = useRouter()
  const { triggerHaptic } = useHapticFeedback()
  const hasJoinedPosterIdentity = typeof username === 'string' && poster_avatar !== undefined
  const { profile: posterProfile, loading: profileLoading } = useNormalizedProfile(
    user_id ?? undefined,
    // Skip the Supabase profile lookup when the bounty row already carries
    // both username and avatar state from the feed JOIN, including null avatars.
    { enabled: !hasJoinedPosterIdentity }
  )
  const [resolvedUsername, setResolvedUsername] = useState<string>(username || 'Loading...')
  const avatarUrl = poster_avatar || posterProfile?.avatar

  useEffect(() => {
    if (username) { setResolvedUsername(username); return }
    if (posterProfile?.username) { setResolvedUsername(posterProfile.username); return }
    setResolvedUsername(profileLoading ? 'Loading...' : 'Anonymous')
  }, [username, posterProfile?.username, profileLoading])

  const handleAvatarPress = useCallback((e: any) => {
    e.stopPropagation()
    triggerHaptic('light')
    if (user_id) router.push(`/profile/${user_id}`)
  }, [user_id, router, triggerHaptic])

  const handleBountyPress = useCallback(() => {
    triggerHaptic('light')
    setShowDetail(true)
  }, [triggerHaptic])

  const hasCredibility = Boolean(
    dateLabel && credibility && (credibility.score != null || credibility.quote || credibility.note)
  )

  const accessibilityLabel = `Bounty: ${title} by ${resolvedUsername}${isForHonor ? ', for honor' : `, $${price}`}${work_type === 'online' ? ', online work' : location ? `, ${location}` : distance !== null ? `, ${distance} miles away` : ', location to be determined'}${dateLabel ? `, ${dateLabel}` : ''}${credibility?.score != null ? `, rated ${credibility.score} out of 5` : ''}${credibility?.note ? `, ${credibility.note}` : ''}${incomplete ? `, limited details${missingSummary ? `, ${missingSummary}` : ''}` : ''}`

  return (
    <>
      <TouchableOpacity
        activeOpacity={0.8}
        style={[s.row, dateLabel ? s.rowStacked : null, style]}
        onPress={handleBountyPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint="Tap to view bounty details and apply"
      >
        {/* Attribution line, e.g. "<name> completed this · <date>". Sits above
            the body so it spans the card's full width and stays on one line. */}
        {dateLabel ? (
          <Text style={s.dateText} numberOfLines={1}>{dateLabel}</Text>
        ) : null}

        <View style={[s.rowInner, dateLabel ? s.rowInnerStacked : null]}>
        {/* Leading avatar */}
        <TouchableOpacity
          onPress={handleAvatarPress}
          disabled={!user_id}
          style={[s.leadingAvatarWrap, dateLabel ? s.leadingAvatarWrapStacked : null]}
          accessibilityRole="button"
          accessibilityLabel={`View ${resolvedUsername}'s profile`}
        >
        </TouchableOpacity>

        {/* Main content */}
        <View style={[s.mainContent, dateLabel ? s.mainContentStacked : null]}>
          {/* Truncate with an ellipsis rather than letting a long title add
              lines: cards in the completed-work carousel share one fixed
              height, so extra lines would push the meta row out of view. */}
          <Text
            style={[s.title, dateLabel ? s.titleStacked : null]}
            numberOfLines={2}
            ellipsizeMode="tail"
          >
            {title}
          </Text>
          <View style={[s.metaRow, dateLabel ? s.metaRowStacked : null]}>
            <Text style={s.username}>{resolvedUsername}</Text>
            <View style={s.dot} />
            {work_type === 'online' ? (
              <View style={s.onlineBadge}>
                <MaterialIcons name="wifi" size={10} color={theme.primary} />
                <Text style={s.onlineText}>Online</Text>
              </View>
            ) : location ? (
              <Text style={s.distance} numberOfLines={1}>{location}</Text>
            ) : distance === null ? (
              <Text style={s.distance}>Location TBD</Text>
            ) : (
              <Text style={s.distance}>{distance} mi</Text>
            )}
          </View>
          {incomplete && (
            <View style={s.limitedRow}>
              <MaterialIcons name="info-outline" size={11} color={theme.textSecondary} />
              <Text style={s.limitedText} numberOfLines={1}>
                Limited details{missingSummary ? ` · ${missingSummary}` : ''}
              </Text>
            </View>
          )}
        </View>

        {/* Trailing price and chevron */}
        <View style={[s.trailing, dateLabel ? s.trailingStacked : null]}>
          {isForHonor ? (
            <View style={s.honorBadge}>
              <MaterialIcons name="favorite" size={12} color="#052e1b" />
              <Text style={s.honorText}>For Honor</Text>
            </View>
          ) : (
            <Text style={s.price}>${price}</Text>
          )}
          {!dateLabel && (
            <MaterialIcons name="chevron-right" size={20} color={theme.textSecondary} />
          )}
        </View>
        </View>

        {/* Credibility footer: what the poster thought of the work. */}
        {hasCredibility && (
          <View style={s.credFooter}>
            <View style={s.credChips}>
              {credibility?.score != null && (
                <View style={s.ratingPill}>
                  <MaterialIcons name="star" size={12} color="#b45309" />
                  <Text style={s.ratingText}>{credibility.score.toFixed(1)}</Text>
                </View>
              )}
              {credibility?.note ? (
                <View style={s.notePill}>
                  <Text style={s.noteText} numberOfLines={1}>{credibility.note}</Text>
                </View>
              ) : null}
            </View>
            {credibility?.quote ? (
              <Text style={s.quoteText} numberOfLines={2}>&ldquo;{credibility.quote}&rdquo;</Text>
            ) : null}
          </View>
        )}
      </TouchableOpacity>

      {showDetail && (
        <BountyDetailModal
          bounty={{ id, username: resolvedUsername, title, price, distance, location: location ?? undefined, description, user_id, work_type, poster_avatar: poster_avatar ?? undefined, is_for_honor: isForHonor }}
          onClose={() => setShowDetail(false)}
        />
      )}
    </>
  )
}

export const BountyCompactItem = React.memo(BountyCompactItemComponent, (prev, next) =>
  prev.id === next.id &&
  prev.title === next.title &&
  prev.username === next.username &&
  prev.price === next.price &&
  prev.distance === next.distance &&
  prev.location === next.location &&
  prev.description === next.description &&
  prev.isForHonor === next.isForHonor &&
  prev.user_id === next.user_id &&
  prev.work_type === next.work_type &&
  prev.poster_avatar === next.poster_avatar &&
  prev.incomplete === next.incomplete &&
  prev.missingSummary === next.missingSummary &&
  prev.dateLabel === next.dateLabel &&
  // Compared field by field: callers build this object inline, so an identity
  // check would re-render every time, and ignoring it would keep a stale review
  // on screen once ratings finish loading.
  prev.credibility?.score === next.credibility?.score &&
  prev.credibility?.quote === next.credibility?.quote &&
  prev.credibility?.note === next.credibility?.note &&
  prev.style === next.style
)

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: t.isDark ? 'rgba(2,44,34,0.55)' : t.surface,
      borderRadius: SPACING.ELEMENT_GAP,
      paddingHorizontal: SPACING.ELEMENT_GAP,
      paddingVertical: SPACING.ELEMENT_GAP,
      marginBottom: 10,
      minHeight: SIZING.MIN_TOUCH_TARGET + SPACING.ELEMENT_GAP,
      borderWidth: t.isDark ? 0 : 1,
      borderColor: t.border,
    },
    // With an attribution line the card becomes a column: that line, then the
    // usual avatar / content / price row beneath it.
    rowStacked: {
      flexDirection: 'column',
      alignItems: 'stretch',
    },
    rowInner: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'stretch',
      flex: 1,
    },
    // Under an attribution line the body must not absorb the card's leftover
    // height: flex 0 keeps it at its own size and top-aligns title, poster and
    // price directly beneath that line instead of centering them in the gap.
    rowInnerStacked: {
      flex: 0,
      // A centered column, not a row: with the title and attribution centered
      // there is no left edge for the poster line to hang off, so the whole
      // stack shares one axis and the price becomes a chip beneath it.
      flexDirection: 'column',
      alignItems: 'center',
      alignSelf: 'stretch',
    },
    leadingAvatarWrapStacked: {
      marginRight: 0,
      marginBottom: 6,
    },
    mainContentStacked: {
      alignSelf: 'stretch',
      // mainContent is flex: 1, which in a row means "take the leftover width".
      // In this stacked column it would mean "take the leftover height" — and
      // the column is content-sized, so there is none: the title and poster
      // collapsed to zero height and were clipped. Size to content instead.
      flexGrow: 0,
      flexShrink: 0,
      flexBasis: 'auto',
      minHeight: 0,
    },
    metaRowStacked: {
      justifyContent: 'center',
    },
    trailingStacked: {
      flexDirection: 'row',
      alignItems: 'center',
      marginLeft: 0,
      marginTop: 6,
      gap: 6,
    },
    credFooter: {
      alignSelf: 'stretch',
      alignItems: 'center',
      marginTop: 8,
      gap: 4,
    },
    credChips: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      flexWrap: 'wrap',
    },
    ratingPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      paddingHorizontal: 7,
      paddingVertical: 2,
      borderRadius: 999,
      backgroundColor: t.isDark ? 'rgba(251,191,36,0.16)' : 'rgba(245,158,11,0.12)',
    },
    ratingText: {
      fontSize: TYPOGRAPHY.SIZE_XSMALL,
      fontWeight: '700',
      color: t.isDark ? '#fcd34d' : '#b45309',
    },
    notePill: {
      paddingHorizontal: 7,
      paddingVertical: 2,
      borderRadius: 999,
      backgroundColor: t.isDark ? 'rgba(16,185,129,0.16)' : 'rgba(5,150,105,0.10)',
    },
    noteText: {
      fontSize: TYPOGRAPHY.SIZE_XSMALL,
      fontWeight: '600',
      color: t.primary,
    },
    quoteText: {
      fontSize: TYPOGRAPHY.SIZE_XSMALL,
      lineHeight: getLineHeight(TYPOGRAPHY.SIZE_XSMALL),
      fontStyle: 'italic',
      color: t.textSecondary,
      textAlign: 'center',
    },
    // Who did the work, centered above the title — a quiet caption, so it reads
    // as context for the card rather than competing with the title.
    dateText: {
      color: t.textSecondary,
      fontSize: TYPOGRAPHY.SIZE_XSMALL,
      lineHeight: getLineHeight(TYPOGRAPHY.SIZE_XSMALL),
      fontWeight: '400',
      textAlign: 'center',
      alignSelf: 'stretch',
      marginBottom: 2,
    },
    leadingAvatarWrap: {
      marginRight: SPACING.ELEMENT_GAP,
    },
    avatar: {
      width: 36,
      height: 36,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: t.isDark ? 'rgba(110,231,183,0.5)' : t.border,
    },
    avatarFallback: {
      backgroundColor: t.isDark ? '#064e3b' : t.surfaceSecondary,
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarText: {
      color: t.isDark ? '#a7f3d0' : t.primaryLight,
      fontSize: 12,
      fontWeight: '700',
    },
    // Larger title for the attribution layout (a profile's completed work),
    // where the card is taller and the title is the thing being read. The feed
    // keeps the denser default.
    titleStacked: {
      fontSize: TYPOGRAPHY.SIZE_HEADER,
      lineHeight: getLineHeight(TYPOGRAPHY.SIZE_HEADER),
      // Centered under the centered attribution line, so the two read as one
      // stacked heading rather than two differently-aligned lines.
      textAlign: 'center',
      alignSelf: 'stretch',
    },
    mainContent: {
      flex: 1,
      justifyContent: 'center',
      minHeight: SIZING.MIN_TOUCH_TARGET,
    },
    title: {
      color: t.text,
      fontWeight: '700',
      fontSize: TYPOGRAPHY.SIZE_BODY,
      lineHeight: getLineHeight(TYPOGRAPHY.SIZE_BODY),
      marginBottom: 4,
    },
    metaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      flexShrink: 1,
    },
    limitedRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      marginTop: 3,
    },
    limitedText: {
      color: t.textSecondary,
      fontSize: TYPOGRAPHY.SIZE_XSMALL,
      fontWeight: '600',
      flexShrink: 1,
    },
    username: {
      color: t.isDark ? '#a7f3d0' : t.primary,
      fontSize: TYPOGRAPHY.SIZE_XSMALL,
    },
    dot: {
      width: 4,
      height: 4,
      borderRadius: 2,
      backgroundColor: t.textSecondary,
      marginHorizontal: 6,
      opacity: 0.9,
    },
    distance: {
      color: t.textSecondary,
      fontSize: TYPOGRAPHY.SIZE_XSMALL,
      flexShrink: 1,
    },
    onlineBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: t.isDark ? 'rgba(16,185,129,0.15)' : 'rgba(5,150,105,0.08)',
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: SPACING.COMPACT_GAP,
      gap: 2,
    },
    onlineText: {
      fontSize: 10,
      fontWeight: '600',
      color: t.primary,
    },
    trailing: {
      alignItems: 'flex-end',
      justifyContent: 'center',
      marginLeft: SPACING.ELEMENT_GAP,
    },
    price: {
      color: t.isDark ? '#fcd34d' : t.primary,
      fontWeight: '800',
      fontSize: 16,
      marginBottom: 2,
    },
    honorBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: '#a7f3d0',
      borderRadius: 999,
      paddingHorizontal: 8,
      paddingVertical: 4,
      gap: 4,
      marginBottom: 2,
    },
    honorText: {
      color: '#052e1b',
      fontWeight: '800',
      fontSize: 12,
    },
  })
}

export default BountyCompactItem
