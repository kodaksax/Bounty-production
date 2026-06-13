"use client"

import React, { useEffect, useMemo, useRef } from "react"
import { Animated, FlatList, StyleSheet, Text, View } from "react-native"
import { SPACING, TYPOGRAPHY } from '../lib/constants/accessibility'
import type { Bounty } from '../lib/services/database.types'
import { useAppThemeContext } from '../lib/themes/AppThemeContext'
import type { AppTheme } from '../lib/themes/types'
import { BountyFeaturedItem } from './bounty-featured-item'
import { BountyGridItem, GRID_CARD_WIDTH } from './bounty-grid-item'

// ── Category definitions ───────────────────────────────────────────────────

interface CategoryDef {
  label: string
  icon: string
  color: string
}

const CATEGORY_DEFS: Record<string, CategoryDef> = {
  Tech:     { label: 'Tech',     icon: 'computer',       color: '#3b82f6' },
  Design:   { label: 'Design',   icon: 'palette',        color: '#a855f7' },
  Writing:  { label: 'Writing',  icon: 'edit',           color: '#f59e0b' },
  Labor:    { label: 'Labor',    icon: 'build',          color: '#f97316' },
  Delivery: { label: 'Delivery', icon: 'local-shipping', color: '#06b6d4' },
  Other:    { label: 'Other',    icon: 'work',           color: '#8b5cf6' },
}

const CATEGORY_ORDER = ['Tech', 'Design', 'Writing', 'Labor', 'Delivery', 'Other']

// ── Keyword-based classification ───────────────────────────────────────────

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  Tech: [
    'javascript', 'typescript', 'react', 'python', 'code', 'coding', 'programming',
    'web', 'app', 'software', 'developer', 'database', 'api', 'ios', 'android',
    'mobile', 'tech', 'ai ', 'machine learning', 'data science', 'computer', 'excel',
    ' it ', 'network', 'cloud', 'devops', 'backend', 'frontend', 'fullstack',
    'html', 'css', 'sql', 'java', 'node', 'server', 'bug', 'debug', 'wordpress',
    'shopify', 'automation', 'script', 'bot', 'plugin',
  ],
  Design: [
    'design', 'figma', 'photoshop', 'illustrator', 'logo', 'ui', 'ux', 'graphic',
    'visual', 'brand', 'creative', 'art', 'illustration', 'sketch', 'layout',
    'typography', 'wireframe', 'mockup', 'canva', 'animation', '3d', 'video edit',
    'photo edit', 'thumbnail', 'banner', 'poster', 'infographic', 'icon',
  ],
  Writing: [
    'writ', 'content', 'article', 'blog', 'copy', 'seo', 'edit', 'essay',
    'proofread', 'translat', 'caption', 'script', 'story', 'review', 'resume',
    'cover letter', 'description', 'newsletter', 'email campaign', 'ghostwrit',
    'social media post',
  ],
  Labor: [
    'mow', 'lawn', 'clean', 'mov', 'lift', 'repair', 'fix', 'install', 'build',
    'paint', 'yard', 'handyman', 'plumb', 'electric', 'carpent', 'haul',
    'assembl', 'furniture', 'snow', 'garden', 'shovel', 'pressure wash',
    'gutter', 'drywall', 'flooring', 'roof', 'fence', 'demolit', 'junk remov',
  ],
  Delivery: [
    'deliver', 'pickup', 'pick up', 'driver', 'transport', 'courier', 'ship',
    'errand', 'drive', 'drop off', 'grocery', 'package', 'luggage', 'move stuff',
    'bring', 'fetch', 'run to', 'go to store',
  ],
}

function getBountyCategory(bounty: Bounty): string {
  const haystack = [bounty.title, bounty.description, bounty.skills_required]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  for (const cat of CATEGORY_ORDER.slice(0, -1)) {
    if (CATEGORY_KEYWORDS[cat].some(kw => haystack.includes(kw))) return cat
  }
  return 'Other'
}

// ── Data shaping ───────────────────────────────────────────────────────────

type HeaderRow   = { type: 'header';   categoryKey: string }
type FeaturedRow = { type: 'featured'; item: Bounty; categoryKey: string }
type PairRow     = { type: 'pair';     left: Bounty; right: Bounty | null; categoryKey: string }
type GridRow     = HeaderRow | FeaturedRow | PairRow

function buildGridRows(bounties: Bounty[]): GridRow[] {
  const grouped: Record<string, Bounty[]> = {}
  for (const b of bounties) {
    const cat = getBountyCategory(b)
    if (!grouped[cat]) grouped[cat] = []
    grouped[cat].push(b)
  }

  const rows: GridRow[] = []
  for (const catKey of CATEGORY_ORDER) {
    const raw = grouped[catKey]
    if (!raw?.length) continue

    // Sort descending by price so the featured slot is always the highest-paying
    const items = [...raw].sort((a, b) => Number(b.amount) - Number(a.amount))

    rows.push({ type: 'header', categoryKey: catKey })
    rows.push({ type: 'featured', item: items[0], categoryKey: catKey })
    for (let i = 1; i < items.length; i += 2) {
      rows.push({ type: 'pair', left: items[i], right: items[i + 1] ?? null, categoryKey: catKey })
    }
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
  listHeader?: React.ReactNode
}

// ── Component ──────────────────────────────────────────────────────────────

export function BountyGridFeed({ bounties, bountyDistances, listHeader }: BountyGridFeedProps) {
  const { theme } = useAppThemeContext()
  const s = useMemo(() => makeStyles(theme), [theme])

  const rows = useMemo(() => buildGridRows(bounties), [bounties])

  const renderRow = ({ item, index }: { item: GridRow; index: number }) => {
    let content: React.ReactNode

    if (item.type === 'header') {
      const def = CATEGORY_DEFS[item.categoryKey]
      content = (
        <Text style={s.sectionTitle}>{def.label}</Text>
      )
    } else if (item.type === 'featured') {
      const def = CATEGORY_DEFS[item.categoryKey]
      const b = item.item
      content = (
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
        />
      )
    } else {
      const { left, right } = item
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
  }

  return (
    <FlatList
      data={rows}
      keyExtractor={(item, i) =>
        item.type === 'header'   ? `h-${item.categoryKey}` :
        item.type === 'featured' ? `f-${String(item.item.id)}` :
        `p-${i}`
      }
      renderItem={renderRow}
      contentContainerStyle={s.list}
      showsVerticalScrollIndicator={false}
      ListHeaderComponent={listHeader ? () => <>{listHeader}</> : undefined}
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
    pairRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 10,
    },
    sectionTitle: {
      fontSize: 35,
      fontWeight: 'bold',
      color: t.text,
      marginTop: 24,
      marginBottom: 12,
    },
  })
}
