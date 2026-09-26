"use client"

import React, { useCallback, useEffect, useMemo, useRef } from "react"
import { Animated, Dimensions, FlatList, ScrollView, StyleSheet, View } from "react-native"
import type { FlatListProps } from "react-native"
import { SPACING } from '../lib/constants/accessibility'

const FEATURED_CARD_WIDTH = Dimensions.get('window').width * 0.78
import type { Bounty } from '../lib/services/database.types'
import { useAppThemeContext } from '../lib/themes/AppThemeContext'
import type { AppTheme } from '../lib/themes/types'
import { BOUNTY_CATEGORIES, getBountyCategoryDef } from '../lib/constants/bounty-categories'
import {
  getBountyCompleteness,
  summarizeMissingDetails,
  type BountyCompleteness,
} from '../lib/utils/bounty-completeness'
import { BountyFeaturedItem, FEATURED_CARD_HEIGHT } from './bounty-featured-item'
import { buildGridRows, getBountyCategory, type GridRow } from './bounty-grid-rows'
import { BountyGridItem, GRID_CARD_WIDTH } from './bounty-grid-item'

// ── Category definitions ───────────────────────────────────────────────────
// Keyed by label to match the categoryKey values produced by getBountyCategory
// below. Source of truth for id/label/icon/color is lib/constants/bounty-categories.ts.

interface CategoryDef {
  label: string
  icon: string
  color: string
}

const CATEGORY_DEFS: Record<string, CategoryDef> = Object.fromEntries(
  BOUNTY_CATEGORIES.map((c) => [c.label, { label: c.label, icon: c.icon, color: c.color }])
)

// ── Animated row wrapper (staggered entrance) ──────────────────────────────

interface AnimatedRowProps {
  index: number
  children: React.ReactNode
}

function AnimatedRow({ index, children }: AnimatedRowProps) {
  const anim = useRef(new Animated.Value(0)).current

  useEffect(() => {
    Animated.timing(anim, {
      toValue: 1,
      duration: 380,
      delay: Math.min(index, 6) * 65,
      useNativeDriver: true,
    }).start()
  }, [])

  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [22, 0] })

  return (
    <Animated.View style={{ opacity: anim, transform: [{ translateY }] }}>
      {children}
    </Animated.View>
  )
}

// ── Props ──────────────────────────────────────────────────────────────────

interface BountyGridFeedProps {
  bounties: Bounty[]
  bountyDistances: Map<string, number | null>
  listHeader?: React.ReactElement
  /** Forwarded to the underlying FlatList — the feed uses it to tint the
   *  status-bar area green while the banner in `listHeader` still reaches
   *  the top of the screen. */
  onScroll?: FlatListProps<unknown>['onScroll']
}

// ── Component ──────────────────────────────────────────────────────────────

export function BountyGridFeed({ bounties, bountyDistances, listHeader, onScroll }: BountyGridFeedProps) {
  const { theme } = useAppThemeContext()
  const s = useMemo(() => makeStyles(theme), [theme])

  // scope / where / when presence per bounty — drives the "Limited details"
  // badge on the cards and the demotion in buildGridRows.
  const completenessById = useMemo(() => {
    const m = new Map<string, BountyCompleteness>()
    bounties.forEach(b => m.set(String(b.id), getBountyCompleteness(b)))
    return m
  }, [bounties])

  const rows = useMemo(
    () => buildGridRows(bounties, completenessById),
    [bounties, completenessById]
  )

  const renderRow = useCallback(({ item, index }: { item: GridRow; index: number }) => {
    const incompleteProps = (b: Bounty) => {
      const c = completenessById.get(String(b.id))
      return c && !c.isComplete
        ? { incomplete: true, missingSummary: summarizeMissingDetails(c.missing) }
        : { incomplete: false, missingSummary: '' }
    }
    let content: React.ReactNode

    if (item.type === 'featuredCarousel') {
      content = (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={s.carousel}
          contentContainerStyle={s.carouselContent}
        >
          {item.items.map(({ item: b, categoryKey }) => {
            const def = CATEGORY_DEFS[categoryKey]
            return (
              <View key={String(b.id)} style={{ width: FEATURED_CARD_WIDTH, height: FEATURED_CARD_HEIGHT }}>
                <BountyFeaturedItem
                  id={b.id}
                  title={b.title}
                  username={b.username}
                  price={Number(b.amount)}
                  distance={bountyDistances.get(String(b.id)) ?? null}
                  location={b.location}
                  description={b.description}
                  isForHonor={Boolean(b.is_for_honor)}
                  user_id={b.user_id}
                  work_type={b.work_type}
                  poster_avatar={b.poster_avatar ?? undefined}
                  categoryColor={def.color}
                  categoryLabel={def.label}
                  {...incompleteProps(b)}
                  attachments_json={b.attachments_json}
                  schedule_type={b.schedule_type}
                  start_date={b.start_date}
                  end_date={b.end_date}
                  duration_minutes={b.duration_minutes}
                  is_time_sensitive={b.is_time_sensitive}
                />
              </View>
            )
          })}
        </ScrollView>
      )
    } else {
      const { left, right } = item
      const leftDef = CATEGORY_DEFS[item.categoryKey]
      const rightDef = item.rightCategoryKey ? CATEGORY_DEFS[item.rightCategoryKey] : null
      content = (
        <View style={s.pairRow}>
          <BountyGridItem
            id={left.id}
            title={left.title}
            username={left.username}
            price={Number(left.amount)}
            distance={bountyDistances.get(String(left.id)) ?? null}
            location={left.location}
            description={left.description}
            isForHonor={Boolean(left.is_for_honor)}
            user_id={left.user_id}
            work_type={left.work_type}
            poster_avatar={left.poster_avatar ?? undefined}
            end_date={left.end_date ?? left.deadline}
            attachments_json={left.attachments_json}
            schedule_type={left.schedule_type}
            start_date={left.start_date}
            duration_minutes={left.duration_minutes}
            is_time_sensitive={left.is_time_sensitive}
            categoryColor={leftDef.color}
            categoryLabel={leftDef.label}
            {...incompleteProps(left)}
          />
          {right ? (
            <BountyGridItem
              id={right.id}
              title={right.title}
              username={right.username}
              price={Number(right.amount)}
              distance={bountyDistances.get(String(right.id)) ?? null}
              location={right.location}
              description={right.description}
              isForHonor={Boolean(right.is_for_honor)}
              user_id={right.user_id}
              work_type={right.work_type}
              poster_avatar={right.poster_avatar ?? undefined}
              end_date={right.end_date ?? right.deadline}
              attachments_json={right.attachments_json}
              schedule_type={right.schedule_type}
              start_date={right.start_date}
              duration_minutes={right.duration_minutes}
              is_time_sensitive={right.is_time_sensitive}
              categoryColor={rightDef?.color}
              categoryLabel={rightDef?.label}
              {...incompleteProps(right)}
            />
          ) : (
            <View style={{ width: GRID_CARD_WIDTH }} />
          )}
        </View>
      )
    }

    return (
      <AnimatedRow index={index}>
        {content}
      </AnimatedRow>
    )
  }, [bountyDistances, s, completenessById])

  return (
    <FlatList
      data={rows}
      keyExtractor={(item, i) =>
        item.type === 'featuredCarousel' ? 'featured-carousel' : `p-${i}`
      }
      renderItem={renderRow}
      contentContainerStyle={s.list}
      showsVerticalScrollIndicator={false}
      ListHeaderComponent={listHeader ?? undefined}
      onScroll={onScroll}
      scrollEventThrottle={16}
      removeClippedSubviews
      maxToRenderPerBatch={8}
      windowSize={7}
      initialNumToRender={6}
    />
  )
}

// ── Styles ─────────────────────────────────────────────────────────────────

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    list: {
      paddingHorizontal: SPACING.SCREEN_HORIZONTAL,
      paddingBottom: 120,
      paddingTop: 8,
    },
    carousel: {
      marginHorizontal: -SPACING.SCREEN_HORIZONTAL,
      marginBottom: 14,
    },
    carouselContent: {
      paddingHorizontal: SPACING.SCREEN_HORIZONTAL,
      gap: 12,
    },
    pairRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 10,
    },
  })
}
