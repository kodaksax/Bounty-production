"use client"

import React, { useCallback, useEffect, useMemo, useRef } from "react"
import { Animated, Dimensions, FlatList, ScrollView, StyleSheet, View } from "react-native"
import { SPACING } from '../lib/constants/accessibility'

const FEATURED_CARD_WIDTH = Dimensions.get('window').width * 0.78
import type { Bounty } from '../lib/services/database.types'
import { useAppThemeContext } from '../lib/themes/AppThemeContext'
import type { AppTheme } from '../lib/themes/types'
import { BOUNTY_CATEGORIES, getBountyCategoryDef } from '../lib/constants/bounty-categories'
import { BountyFeaturedItem } from './bounty-featured-item'
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

// Category is the metadata the poster explicitly chose when creating the
// bounty (see StepTitle.tsx) — never inferred from title/description text.
function getBountyCategory(bounty: Bounty): string {
  const def = getBountyCategoryDef(bounty.category)
  return def ? def.label : 'Other'
}

// ── Data shaping ───────────────────────────────────────────────────────────

type FeaturedCarouselRow = { type: 'featuredCarousel'; items: Array<{ item: Bounty; categoryKey: string }> }
type PairRow             = { type: 'pair'; left: Bounty; right: Bounty | null; categoryKey: string; rightCategoryKey: string | null }
type GridRow             = FeaturedCarouselRow | PairRow

const FEATURED_COUNT = 3

function buildGridRows(bounties: Bounty[]): GridRow[] {
  // Sort globally: highest price first, honor (no price) last
  const sorted = [...bounties].sort((a, b) => {
    const aHonor = Boolean(a.is_for_honor)
    const bHonor = Boolean(b.is_for_honor)
    if (aHonor && !bHonor) return 1
    if (!aHonor && bHonor) return -1
    return Number(b.amount || 0) - Number(a.amount || 0)
  })

  const featured = sorted.slice(0, FEATURED_COUNT)
  const rest     = sorted.slice(FEATURED_COUNT)

  const rows: GridRow[] = []

  if (featured.length > 0) {
    rows.push({
      type: 'featuredCarousel',
      items: featured.map(b => ({ item: b, categoryKey: getBountyCategory(b) })),
    })
  }

  for (let i = 0; i < rest.length; i += 2) {
    const right = rest[i + 1] ?? null
    rows.push({
      type: 'pair',
      left: rest[i],
      right,
      categoryKey: getBountyCategory(rest[i]),
      rightCategoryKey: right ? getBountyCategory(right) : null,
    })
  }

  return rows
}

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
}

// ── Component ──────────────────────────────────────────────────────────────

export function BountyGridFeed({ bounties, bountyDistances, listHeader }: BountyGridFeedProps) {
  const { theme } = useAppThemeContext()
  const s = useMemo(() => makeStyles(theme), [theme])

  const rows = useMemo(() => buildGridRows(bounties), [bounties])

  const renderRow = useCallback(({ item, index }: { item: GridRow; index: number }) => {
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
              <View key={String(b.id)} style={{ width: FEATURED_CARD_WIDTH, height: 290 }}>
                <BountyFeaturedItem
                  id={b.id}
                  title={b.title}
                  username={b.username}
                  price={Number(b.amount)}
                  distance={bountyDistances.get(String(b.id)) ?? null}
                  description={b.description}
                  isForHonor={Boolean(b.is_for_honor)}
                  user_id={b.user_id}
                  work_type={b.work_type}
                  poster_avatar={b.poster_avatar}
                  categoryColor={def.color}
                  categoryLabel={def.label}
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
            description={left.description}
            isForHonor={Boolean(left.is_for_honor)}
            user_id={left.user_id}
            work_type={left.work_type}
            poster_avatar={left.poster_avatar}
            end_date={left.end_date ?? left.deadline}
            categoryColor={leftDef.color}
            categoryLabel={leftDef.label}
          />
          {right ? (
            <BountyGridItem
              id={right.id}
              title={right.title}
              username={right.username}
              price={Number(right.amount)}
              distance={bountyDistances.get(String(right.id)) ?? null}
              description={right.description}
              isForHonor={Boolean(right.is_for_honor)}
              user_id={right.user_id}
              work_type={right.work_type}
              poster_avatar={right.poster_avatar}
              end_date={right.end_date ?? right.deadline}
              categoryColor={rightDef?.color}
              categoryLabel={rightDef?.label}
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
  }, [bountyDistances, s])

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
