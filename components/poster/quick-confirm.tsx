/**
 * 4b / E.2 "quick confirm": who you're choosing, what happens and where the
 * money comes from, with a button that counts down and confirms by itself at
 * 0:00 unless the poster goes back or changes the payment.
 *
 * Because the timeout can charge a saved card, the countdown runs only while
 * the poster can see it: it pauses when the app isn't in the foreground, when
 * the screen isn't focused, while `paused` (a sheet over it) and while `ready`
 * is false, and it never runs with
 * a screen reader on (or until we know one isn't). It fires at most once, and
 * never after Go back, Change or unmount.
 */
import { MaterialIcons } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import * as React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, AppState, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useIsScreenFocused } from '../../hooks/useRouteFocus';
import type { IconName } from '../../lib/my-jobs/types';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import { FOCUS, type PosterPalette } from '../../lib/themes/poster-palette';
import { PosterButton } from './poster-button';

export interface QuickConfirmRow {
  icon: string;
  title: string;
  detail?: string | null;
  /** Shows a "Change" link on the row. */
  onChange?: () => void;
}

export function QuickConfirm({
  name,
  avatarUri,
  sub,
  idLine,
  rows,
  note,
  seconds,
  ready,
  paused = false,
  busy = false,
  paddingTop,
  paddingBottom,
  onConfirm,
  onBack,
}: {
  name: string;
  avatarUri?: string | null;
  sub?: string | null;
  /** The helper's ID line (components/poster/id-check.tsx), under `sub`. */
  idLine?: React.ReactNode;
  rows: QuickConfirmRow[];
  note: string;
  seconds: number;
  /** False while the payment method is still loading: no countdown, no button. */
  ready: boolean;
  /**
   * True while something covers this screen (the "What Bounty checks"
   * sheet): the countdown holds where it is and resumes when it closes.
   */
  paused?: boolean;
  /**
   * Confirmed; the hire is being recorded. The button says "Choosing Ana…"
   * with a spinner until the gate closes (E2E-05: after "Looks good" the
   * screen used to look unchanged for a second or more).
   */
  busy?: boolean;
  paddingTop: number;
  paddingBottom: number;
  onConfirm: (how: 'tap' | 'timeout') => void;
  onBack: () => void;
}) {
  const { theme } = useAppThemeContext();
  const p = theme.poster;
  const s = useMemo(() => makeStyles(p), [p]);
  const focused = useIsScreenFocused();
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  // null = not known yet, treated as on.
  const [screenReader, setScreenReader] = useState<boolean | null>(null);
  const [left, setLeft] = useState(seconds);
  const settledRef = useRef(false);
  const confirmRef = useRef(onConfirm);
  confirmRef.current = onConfirm;

  useEffect(() => {
    let active = true;
    const sub1 = AppState.addEventListener('change', (next) => setAppActive(next === 'active'));
    const sub2 = AccessibilityInfo.addEventListener('screenReaderChanged', (on) => setScreenReader(!!on));
    Promise.resolve(AccessibilityInfo.isScreenReaderEnabled())
      .then((on) => active && setScreenReader(!!on))
      .catch(() => active && setScreenReader(true));
    return () => {
      active = false;
      sub1?.remove?.();
      sub2?.remove?.();
    };
  }, []);

  const auto = screenReader === false;
  const running = auto && ready && focused && appActive && !paused;

  const settle = (run: () => void) => {
    if (settledRef.current) return;
    settledRef.current = true;
    run();
  };

  useEffect(() => {
    if (!running || settledRef.current) return;
    const t = setTimeout(() => {
      if (left > 1) {
        setLeft(left - 1);
        return;
      }
      if (settledRef.current) return;
      settledRef.current = true;
      setLeft(0);
      confirmRef.current('timeout');
    }, 1000);
    return () => clearTimeout(t);
  }, [running, left]);

  const initial = name.trim().charAt(0).toUpperCase() || '?';
  return (
    <View style={[s.root, { paddingTop, paddingBottom }]} testID="quick-confirm">
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <View style={s.hero}>
          <View style={s.avatar}>
            {avatarUri ? (
              <ExpoImage source={{ uri: avatarUri }} style={s.avatarImage} contentFit="cover" />
            ) : (
              <Text style={s.initial}>{initial}</Text>
            )}
            <View style={s.badge}>
              <MaterialIcons name="check" size={20} color={p.onFill} />
            </View>
          </View>
          <Text style={s.name}>{name}</Text>
          {sub ? <Text style={s.sub}>{sub}</Text> : null}
          {idLine}
        </View>

        <View style={s.sheet}>
          <Text style={s.title} accessibilityRole="header">{`Choosing ${name}…`}</Text>
          {rows.map((row, i) => (
            <View key={row.title} style={[s.row, i < rows.length - 1 && s.rowDivider]}>
              <MaterialIcons name={row.icon as IconName} size={26} color={p.ink2} />
              <View style={s.rowText}>
                <Text style={s.rowTitle}>{row.title}</Text>
                {row.detail ? <Text style={s.rowDetail}>{row.detail}</Text> : null}
              </View>
              {row.onChange ? (
                <TouchableOpacity
                  onPress={() => settle(row.onChange!)}
                  style={s.change}
                  accessibilityRole="button"
                  accessibilityLabel="Change payment"
                  testID="quick-confirm-change"
                >
                  <Text style={s.changeText}>Change</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ))}
          <Text style={s.note}>{note}</Text>
          {/* The charge on timeout is said in words, not only by the timer. */}
          {auto && ready && !busy ? <Text style={s.note}>{'Confirms by itself when the timer ends. Tap Go back to stop it.'}</Text> : null}
        </View>
      </ScrollView>
      <View style={s.actions}>
        <TouchableOpacity
          onPress={() => settle(() => onConfirm('tap'))}
          disabled={!ready || busy}
          style={[s.cta, !ready && s.ctaDisabled]}
          accessibilityRole="button"
          accessibilityLabel={busy ? `Choosing ${name}` : `Looks good, choose ${name}`}
          accessibilityState={{ disabled: !ready || busy, busy }}
          testID="quick-confirm-yes"
        >
          {auto && ready && !busy ? (
            <View style={[s.fill, { width: `${((seconds - left) / seconds) * 100}%` }]} pointerEvents="none" />
          ) : null}
          {busy ? <ActivityIndicator color={p.onFill} /> : null}
          <Text style={s.ctaText}>
            {busy
              ? `Choosing ${name}…`
              : !ready
                ? 'Checking payment…'
                : auto
                  ? `Looks good (0:${String(left).padStart(2, '0')})`
                  : 'Looks good'}
          </Text>
        </TouchableOpacity>
        {busy ? null : <PosterButton kind="text" label="Go back" onPress={() => settle(onBack)} testID="quick-confirm-back" />}
      </View>
    </View>
  );
}

function makeStyles(p: PosterPalette) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: p.bg, paddingHorizontal: 16 },
    content: { flexGrow: 1, justifyContent: 'flex-end', gap: 14, paddingBottom: 12 },
    hero: { alignItems: 'center', gap: 6, paddingVertical: 18 },
    avatar: {
      width: 112,
      height: 112,
      borderRadius: 56,
      borderWidth: 3,
      borderColor: p.g,
      backgroundColor: p.photo,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 8,
    },
    avatarImage: { width: 106, height: 106, borderRadius: 53 },
    initial: { color: p.photoInk, fontSize: 38, fontWeight: '800' },
    badge: {
      position: 'absolute',
      right: -4,
      bottom: 2,
      width: 34,
      height: 34,
      borderRadius: 17,
      borderWidth: 3,
      borderColor: p.bg,
      backgroundColor: p.g,
      alignItems: 'center',
      justifyContent: 'center',
    },
    name: { color: p.ink, fontSize: 22, fontWeight: '800' },
    sub: { color: p.ink2, fontSize: 16, fontWeight: '600', textAlign: 'center' },
    sheet: { backgroundColor: p.card, borderRadius: 28, borderWidth: 1, borderColor: p.line, paddingTop: 24, paddingHorizontal: 20, paddingBottom: 14 },
    title: { color: p.ink, fontSize: FOCUS.qaHeadline, fontWeight: '800', letterSpacing: -0.4, paddingBottom: 8 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 13 },
    rowDivider: { borderBottomWidth: 1, borderBottomColor: p.line },
    rowText: { flex: 1, gap: 3 },
    rowTitle: { color: p.ink, fontSize: 17, fontWeight: '700', lineHeight: 22 },
    rowDetail: { color: p.ink2, fontSize: 15, fontWeight: '600', lineHeight: 20 },
    change: { minHeight: FOCUS.minTouch, minWidth: FOCUS.minTouch, alignItems: 'center', justifyContent: 'center' },
    changeText: { color: p.gt, fontSize: 16, fontWeight: '700' },
    note: { color: p.ink2, fontSize: 15, lineHeight: 21, paddingTop: 8 },
    actions: { gap: 6, paddingTop: 4 },
    cta: {
      minHeight: FOCUS.buttonPrimary,
      borderRadius: FOCUS.buttonRadius,
      backgroundColor: p.g,
      flexDirection: 'row',
      gap: 10,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    ctaDisabled: { opacity: 0.6 },
    fill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.22)' },
    ctaText: { color: p.onFill, fontSize: 18, fontWeight: '700' },
  });
}
