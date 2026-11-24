/**
 * The small Focus-first blocks from PosterBlock.dc.html that don't need
 * state of their own: NoteBox (`box`), StageToast (`toast`), ConsequenceList
 * (`list3`), StorySoFar (`story`), SectionLabel (`label`), FactsList
 * (`facts`), ReceiptRows (`rows`), EmptyHero (`hero`), FlowTitle (`title`)
 * and FlowNav (`nav`).
 */
import { MaterialIcons } from '@expo/vector-icons';
import * as React from 'react';
import { useEffect, useMemo } from 'react';
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

// ── NoteBox ──────────────────────────────────────────────────────────────
export type NoteTone = 'g' | 'w' | 'e' | 'i' | 'ph' | 'n' | 'bg';

function toneOf(tone: NoteTone, p: PosterPalette) {
  switch (tone) {
    case 'g':
      return { bg: p.gtint, fg: p.ink, ic: p.gt, bd: 'transparent', dashed: false };
    case 'w':
      return { bg: p.wtint, fg: p.wt, ic: p.wt, bd: p.w, dashed: false };
    case 'e':
      return { bg: p.etint, fg: p.ink, ic: p.e, bd: p.e, dashed: false };
    case 'i':
      return { bg: p.itint, fg: p.ink, ic: p.it, bd: 'transparent', dashed: false };
    case 'ph':
      return { bg: p.itint, fg: p.it, ic: p.it, bd: p.it, dashed: true };
    case 'bg':
      return { bg: p.bg, fg: p.ink, ic: p.gt, bd: 'transparent', dashed: false };
    case 'n':
    default:
      return { bg: p.card, fg: p.ink, ic: p.ink2, bd: p.line, dashed: false };
  }
}

export function NoteBox({
  tone = 'n',
  icon,
  title,
  text,
  text2,
  testID,
}: {
  tone?: NoteTone;
  icon?: IconName;
  title?: string | null;
  text?: string | null;
  text2?: string | null;
  testID?: string;
}) {
  const { p, s } = usePosterStyles();
  const t = toneOf(tone, p);
  return (
    <View
      style={[s.box, { backgroundColor: t.bg, borderColor: t.bd, borderStyle: t.dashed ? 'dashed' : 'solid' }]}
      // Error boxes are alerts; everything else is a note read in order.
      accessibilityRole={tone === 'e' ? 'alert' : undefined}
      accessibilityLiveRegion={tone === 'e' ? 'assertive' : undefined}
      testID={testID}
    >
      {icon ? <MaterialIcons name={icon} size={22} color={t.ic} /> : null}
      <View style={s.boxText}>
        {title ? <Text style={[s.boxTitle, { color: t.fg }]}>{title}</Text> : null}
        {text ? <Text style={[s.boxBody, { color: t.fg }]}>{text}</Text> : null}
        {text2 ? <Text style={[s.boxBody, s.bold, { color: t.fg }]}>{text2}</Text> : null}
      </View>
    </View>
  );
}

// ── StageToast ───────────────────────────────────────────────────────────
/**
 * A one-line confirmation of something that already happened ("Offer sent
 * to Jordan."). Announced politely; hides itself after `autoHideMs`.
 */
export function StageToast({
  text,
  icon = 'check-circle',
  autoHideMs = 6000,
  onHide,
}: {
  text: string;
  icon?: IconName;
  autoHideMs?: number;
  onHide?: () => void;
}) {
  const { p, s } = usePosterStyles();
  useEffect(() => {
    if (!onHide || autoHideMs <= 0) return;
    const t = setTimeout(onHide, autoHideMs);
    return () => clearTimeout(t);
  }, [onHide, autoHideMs]);
  return (
    <View style={s.toast} accessibilityRole="text" accessibilityLiveRegion="polite" testID="stage-toast">
      <MaterialIcons name={icon} size={22} color={p.card} />
      <Text style={s.toastText}>{text}</Text>
    </View>
  );
}

// ── SectionLabel ─────────────────────────────────────────────────────────
export function SectionLabel({ children }: { children: string }) {
  const { s } = usePosterStyles();
  return (
    <Text style={s.label} accessibilityRole="header">
      {children}
    </Text>
  );
}

// ── ConsequenceList ──────────────────────────────────────────────────────
export interface ConsequenceItem {
  icon: IconName;
  title: string;
  detail?: string | null;
  done?: boolean;
}

export function ConsequenceList({ label, items, testID }: { label?: string; items: ConsequenceItem[]; testID?: string }) {
  const { p, s } = usePosterStyles();
  return (
    <View style={s.list3} testID={testID}>
      {label ? <SectionLabel>{label}</SectionLabel> : null}
      {items.map((item) => (
        <View key={item.title} style={s.list3Row}>
          <View style={[s.list3Icon, { backgroundColor: item.done ? p.g : p.gtint }]}>
            <MaterialIcons name={item.icon} size={20} color={item.done ? p.onFill : p.gt} />
          </View>
          <View style={s.list3Text}>
            <Text style={s.list3Title}>{item.title}</Text>
            {item.detail ? <Text style={s.list3Detail}>{item.detail}</Text> : null}
          </View>
        </View>
      ))}
    </View>
  );
}

// ── StorySoFar ───────────────────────────────────────────────────────────
export function StorySoFar({ items, label = 'THE STORY SO FAR' }: { items: { when: string; what: string }[]; label?: string }) {
  const { s } = usePosterStyles();
  if (items.length === 0) return null;
  return (
    <View style={s.story} testID="story-so-far">
      <SectionLabel>{label}</SectionLabel>
      {items.map((item, i) => (
        <View key={`${item.when}:${i}`} style={s.storyRow}>
          <Text style={s.storyWhen}>{item.when}</Text>
          <Text style={s.storyWhat}>{item.what}</Text>
        </View>
      ))}
    </View>
  );
}

// ── FactsList ────────────────────────────────────────────────────────────
export interface FactRow {
  icon: IconName;
  label: string;
  value: string;
  /** Shown in the secondary colour, e.g. "Distance not shown". */
  muted?: boolean;
}

export function FactsList({ rows, tinted = false, testID }: { rows: FactRow[]; tinted?: boolean; testID?: string }) {
  const { p, s } = usePosterStyles();
  if (rows.length === 0) return null;
  return (
    <View style={[s.facts, { backgroundColor: tinted ? p.bg : p.card }]} testID={testID}>
      {rows.map((row, i) => (
        <View
          key={row.label}
          style={[s.factRow, i < rows.length - 1 && s.factDivider]}
          accessible
          accessibilityLabel={`${row.label}: ${row.value}`}
        >
          <MaterialIcons name={row.icon} size={20} color={p.ink2} />
          <Text style={s.factLabel}>{row.label}</Text>
          <Text style={[s.factValue, row.muted && { color: p.ink2, fontWeight: '600' }]}>{row.value}</Text>
        </View>
      ))}
    </View>
  );
}

// ── ReceiptRows ──────────────────────────────────────────────────────────
export function ReceiptRows({ rows, testID }: { rows: { label: string; value: string; strong?: boolean }[]; testID?: string }) {
  const { s } = usePosterStyles();
  return (
    <View style={s.rows} testID={testID}>
      {rows.map((row, i) => (
        <View
          key={row.label}
          style={[s.rowsRow, i < rows.length - 1 && s.factDivider]}
          accessible
          accessibilityLabel={`${row.label}: ${row.value}`}
        >
          <Text style={s.rowsLabel}>{row.label}</Text>
          <Text style={[s.rowsValue, row.strong && s.rowsStrong]}>{row.value}</Text>
        </View>
      ))}
    </View>
  );
}

// ── EmptyHero ────────────────────────────────────────────────────────────
export function EmptyHero({ icon, title, body }: { icon: IconName; title: string; body?: string | null }) {
  const { p, s } = usePosterStyles();
  return (
    <View style={s.hero} accessibilityRole="summary">
      <View style={[s.heroBadge, { backgroundColor: p.g, borderColor: p.gtint }]}>
        <MaterialIcons name={icon} size={44} color={p.onFill} />
      </View>
      <Text style={s.heroTitle} accessibilityRole="header">
        {title}
      </Text>
      {body ? <Text style={s.heroBody}>{body}</Text> : null}
    </View>
  );
}

// ── FlowTitle / FlowNav ──────────────────────────────────────────────────
export function FlowTitle({ title, meta, size = 'xl' }: { title: string; meta?: string | null; size?: 'l' | 'xl' }) {
  const { s } = usePosterStyles();
  return (
    <View style={s.flowTitleWrap}>
      <Text style={[s.flowTitle, { fontSize: size === 'xl' ? FOCUS.flowTitleXL : FOCUS.flowTitle }]} accessibilityRole="header">
        {title}
      </Text>
      {meta ? <Text style={s.flowMeta}>{meta}</Text> : null}
    </View>
  );
}

export function FlowNav({ label, onBack, onHelp }: { label: string; onBack: () => void; onHelp?: () => void }) {
  const { p, s } = usePosterStyles();
  return (
    <View style={s.nav}>
      <TouchableOpacity onPress={onBack} style={s.navBack} accessibilityRole="button" accessibilityLabel={label} testID="flow-back">
        <MaterialIcons name="chevron-left" size={30} color={p.gt} />
        <Text style={s.navBackText}>{label}</Text>
      </TouchableOpacity>
      {onHelp ? (
        <TouchableOpacity onPress={onHelp} style={s.navHelp} accessibilityRole="button" accessibilityLabel="Help with this job">
          <MaterialIcons name="support-agent" size={20} color={p.gt} />
          <Text style={s.navHelpText}>Help</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function makeStyles(p: PosterPalette) {
  return StyleSheet.create({
    bold: { fontWeight: '700' },
    box: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, borderWidth: 1.5, borderRadius: 14, paddingVertical: 13, paddingHorizontal: 14 },
    boxText: { flex: 1, gap: 3 },
    boxTitle: { fontSize: 17, fontWeight: '800' },
    boxBody: { fontSize: 16, lineHeight: 24 },
    toast: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: p.ink, borderRadius: 16, paddingVertical: 14, paddingHorizontal: 16 },
    toastText: { flex: 1, color: p.card, fontSize: 16, lineHeight: 22 },
    label: { color: p.gt, fontSize: FOCUS.label, fontWeight: '800', letterSpacing: FOCUS.labelTracking, paddingTop: 4 },
    list3: { gap: 14 },
    list3Row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
    list3Icon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
    list3Text: { flex: 1, gap: 2, paddingTop: 5 },
    list3Title: { color: p.ink, fontSize: 17, fontWeight: '700', lineHeight: 23 },
    list3Detail: { color: p.ink2, fontSize: 15, lineHeight: 22 },
    story: { gap: 10 },
    storyRow: { flexDirection: 'row', gap: 12 },
    storyWhen: { width: 84, color: p.ink2, fontSize: 15, fontWeight: '700', lineHeight: 23 },
    storyWhat: { flex: 1, color: p.ink, fontSize: 16, lineHeight: 23 },
    facts: { borderRadius: 16, borderWidth: 1, borderColor: p.line, paddingVertical: 2, paddingHorizontal: 16 },
    factRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, minHeight: FOCUS.minTouch },
    factDivider: { borderBottomWidth: 1, borderBottomColor: p.line },
    factLabel: { flex: 1, color: p.ink2, fontSize: 16 },
    factValue: { color: p.ink, fontSize: 16, fontWeight: '800', textAlign: 'right', maxWidth: '58%' },
    rows: { backgroundColor: p.bg, borderRadius: 16, paddingVertical: 2, paddingHorizontal: 16 },
    rowsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, paddingVertical: 11, minHeight: FOCUS.minTouch },
    rowsLabel: { color: p.ink2, fontSize: 16 },
    rowsValue: { color: p.ink, fontSize: 16, fontWeight: '600', textAlign: 'right' },
    rowsStrong: { fontWeight: '800' },
    hero: { gap: 16, paddingTop: 20 },
    heroBadge: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', borderWidth: 8 },
    heroTitle: { color: p.ink, fontSize: 31, fontWeight: '800', letterSpacing: -0.5, lineHeight: 36 },
    heroBody: { color: p.ink2, fontSize: 17, lineHeight: 25 },
    flowTitleWrap: { gap: 6 },
    flowTitle: { color: p.ink, fontWeight: '800', lineHeight: 34, letterSpacing: -0.3 },
    flowMeta: { color: p.ink2, fontSize: 16 },
    nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 56, marginHorizontal: -8 },
    navBack: { flexDirection: 'row', alignItems: 'center', minHeight: FOCUS.buttonText },
    navBackText: { color: p.gt, fontSize: 17, fontWeight: '600' },
    navHelp: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: FOCUS.buttonText, paddingHorizontal: 16, borderRadius: 999, borderWidth: 1.5, borderColor: p.outline, backgroundColor: p.card },
    navHelpText: { color: p.ink, fontSize: 16, fontWeight: '700' },
  });
}
