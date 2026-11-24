/**
 * Focus-first controls with a little state: OtherOptions (`more`), 
 * StarRating (`stars`). None of them needs a swipe or a drag:
 * every choice is a plain button.
 */
import { MaterialIcons } from '@expo/vector-icons';
import * as React from 'react';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { IconName } from '../../lib/my-jobs/types';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import { FOCUS, type PosterPalette } from '../../lib/themes/poster-palette';

function usePosterStyles() {
  const { theme } = useAppThemeContext();
  const p = theme.poster;
  const s = useMemo(() => makeStyles(p), [p]);
  return { p, s };
}

// ── OtherOptions ─────────────────────────────────────────────────────────
export interface OtherOption {
  key: string;
  label: string;
  icon: IconName;
  danger?: boolean;
  onPress: () => void;
  /** Listed but can't run now: dimmed, and its hint says why. */
  disabledReason?: string;
  busy?: boolean;
}

/**
 * The collapsed row for infrequent or destructive actions, so the pinned
 * primary step is never one of several equal buttons.
 */
export function OtherOptions({
  items,
  label = 'Other options',
  initiallyOpen = false,
  testID = 'other-options',
}: {
  items: OtherOption[];
  label?: string;
  initiallyOpen?: boolean;
  testID?: string;
}) {
  const { p, s } = usePosterStyles();
  const [open, setOpen] = useState(initiallyOpen);
  if (items.length === 0) return null;
  return (
    <View style={s.more} testID={testID}>
      <TouchableOpacity
        onPress={() => setOpen((v) => !v)}
        style={s.moreToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={label}
        testID={`${testID}-toggle`}
      >
        <Text style={s.moreLabel}>{label}</Text>
        <MaterialIcons name={open ? 'expand-less' : 'expand-more'} size={24} color={p.ink2} />
      </TouchableOpacity>
      {open
        ? items.map((item) => {
            const color = item.danger ? p.e : p.ink;
            const dimmed = !!item.disabledReason || !!item.busy;
            return (
              <TouchableOpacity
                key={item.key}
                onPress={item.busy ? undefined : item.onPress}
                style={[s.moreItem, dimmed && { opacity: 0.55 }]}
                accessibilityRole="button"
                accessibilityLabel={item.label}
                accessibilityHint={item.disabledReason}
                accessibilityState={{ disabled: !!item.disabledReason, busy: !!item.busy }}
                testID={`option-${item.key}`}
              >
                <MaterialIcons name={item.icon} size={22} color={color} />
                <Text style={[s.moreItemText, { color }]}>{item.label}</Text>
              </TouchableOpacity>
            );
          })
        : null}
    </View>
  );
}

// ── StarRating ───────────────────────────────────────────────────────────
export const STAR_WORDS = ['Poor', 'Fair', 'OK', 'Good', 'Excellent'] as const;

/** "5 out of 5 · Excellent", or the prompt when nothing is picked. */
export function describeStars(value: number): string {
  if (!value || value < 1 || value > 5) return 'Tap a number';
  return `${value} out of 5 · ${STAR_WORDS[value - 1]}`;
}

export function StarRating({
  value,
  onChange,
  disabled = false,
}: {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  const { p, s } = usePosterStyles();
  return (
    <View style={s.starsWrap}>
      <View style={s.stars} accessibilityRole="radiogroup" accessibilityLabel="Your rating">
        {STAR_WORDS.map((word, i) => {
          const n = i + 1;
          const lit = n <= value;
          const isSelected = n === value;
          return (
            <TouchableOpacity
              key={word}
              onPress={() => onChange(n)}
              disabled={disabled}
              style={[
                s.star,
                {
                  backgroundColor: lit ? p.wtint : p.card,
                  borderColor: isSelected ? p.w : lit ? 'transparent' : p.line,
                  borderWidth: isSelected ? 2 : 1.5,
                },
              ]}
              accessibilityRole="radio"
              accessibilityState={{ checked: isSelected, disabled }}
              accessibilityLabel={`${n} out of 5, ${word}`}
              testID={`star-${n}`}
            >
              <MaterialIcons name={lit ? 'star' : 'star-outline'} size={30} color={lit ? p.w : p.ink2} />
              <Text style={s.starNumber}>{n}</Text>
              <Text style={s.starWord}>{word}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <Text style={s.starsSaid} accessibilityLiveRegion="polite">
        {describeStars(value)}
      </Text>
    </View>
  );
}

function makeStyles(p: PosterPalette) {
  return StyleSheet.create({
    more: { borderTopWidth: 1, borderBottomWidth: 1, borderColor: p.line },
    moreToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 56 },
    moreLabel: { color: p.ink, fontSize: 17, fontWeight: '700' },
    moreItem: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, borderTopWidth: 1, borderTopColor: p.line },
    moreItemText: { fontSize: 16, fontWeight: '600' },
    starsWrap: { gap: 10 },
    stars: { flexDirection: 'row', gap: 6 },
    star: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2, minHeight: 76, borderRadius: 14 },
    starNumber: { color: p.ink, fontSize: 14, fontWeight: '700' },
    starWord: { color: p.ink, fontSize: 12, fontWeight: '500' },
    starsSaid: { color: p.ink, fontSize: 17, fontWeight: '700', textAlign: 'center', minHeight: FOCUS.minTouch / 2 },
  });
}
