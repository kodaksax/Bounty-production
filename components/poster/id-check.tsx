/**
 * The helper's ID line and the "What Bounty checks" sheet
 * (lib/utils/id-check-copy.ts has the words and what they are based on).
 *
 * Shown on the person view (D), the offers list (Postings → Requests),
 * screen E and its quick confirm (4b), and the hired stage (G). Always one
 * line: verified or not, never silence, so a poster doesn't read a missing
 * line as "Bounty doesn't check".
 */
import { MaterialIcons } from '@expo/vector-icons';
import * as React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import { FOCUS, type PosterPalette } from '../../lib/themes/poster-palette';
import { describeIdLine, WHAT_BOUNTY_CHECKS_SHEET, WHAT_BOUNTY_CHECKS_TITLE } from '../../lib/utils/id-check-copy';
import { PosterSheet } from './overlays';

export function WhatBountyChecksSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { theme } = useAppThemeContext();
  const p = theme.poster;
  return (
    <PosterSheet visible={visible} title={WHAT_BOUNTY_CHECKS_TITLE} onClose={onClose} testID="what-bounty-checks-sheet">
      {WHAT_BOUNTY_CHECKS_SHEET.map((line) => (
        <Text key={line} style={{ color: p.ink, fontSize: 18, lineHeight: 26 }}>
          {line}
        </Text>
      ))}
    </PosterSheet>
  );
}

/** The link that opens the sheet. */
export function WhatBountyChecksLink({ onPress, testID = 'what-bounty-checks-link' }: { onPress: () => void; testID?: string }) {
  const { theme } = useAppThemeContext();
  const s = useMemo(() => makeStyles(theme.poster), [theme.poster]);
  return (
    <TouchableOpacity
      onPress={onPress}
      style={s.link}
      accessibilityRole="button"
      accessibilityLabel={WHAT_BOUNTY_CHECKS_TITLE}
      accessibilityHint="Opens a short note about ID checks"
      hitSlop={{ top: 6, bottom: 6 }}
      testID={testID}
    >
      <Text style={s.linkText}>{WHAT_BOUNTY_CHECKS_TITLE}</Text>
    </TouchableOpacity>
  );
}

/** `open()` shows the sheet; render `sheet` once, anywhere on the screen. */
export function useWhatBountyChecks(onVisibleChange?: (visible: boolean) => void): { open: () => void; sheet: React.ReactNode } {
  const [visible, setVisible] = useState(false);
  const changeRef = useRef(onVisibleChange);
  changeRef.current = onVisibleChange;
  useEffect(() => {
    changeRef.current?.(visible);
    // Unmounting with the sheet open must not leave the owner paused.
    return () => {
      if (visible) changeRef.current?.(false);
    };
  }, [visible]);
  const open = useCallback(() => setVisible(true), []);
  const close = useCallback(() => setVisible(false), []);
  return { open, sheet: <WhatBountyChecksSheet visible={visible} onClose={close} /> };
}

/**
 * The line with its link, sheet included. `name` is the helper's own name,
 * or null when there isn't one (never a placeholder like "this hunter").
 */
export function IdCheckLine({
  name,
  verified,
  align = 'start',
  testID = 'helper-id-line',
  onSheetVisibleChange,
}: {
  name: string | null | undefined;
  verified: boolean;
  /** 'center' under a centred name (the quick confirm). */
  align?: 'start' | 'center';
  testID?: string;
  /**
   * Told when the sheet opens and closes. The quick confirm pauses its
   * countdown while it is open: the sheet covers Go back.
   */
  onSheetVisibleChange?: (visible: boolean) => void;
}) {
  const { theme } = useAppThemeContext();
  const p = theme.poster;
  const s = useMemo(() => makeStyles(p), [p]);
  const { open, sheet } = useWhatBountyChecks(onSheetVisibleChange);
  const line = describeIdLine(name, verified);
  const center = align === 'center';
  return (
    <View style={[s.wrap, center && s.wrapCenter]} testID={testID}>
      <View style={[s.row, center && s.rowCenter]}>
        <MaterialIcons name={line.icon} size={20} color={line.verified ? p.gt : p.ink2} />
        <Text style={[s.text, { color: line.verified ? p.ink : p.ink2 }, center && s.textCenter]} testID={`${testID}-text`}>
          {line.text}
        </Text>
      </View>
      <WhatBountyChecksLink onPress={open} testID={`${testID}-link`} />
      {sheet}
    </View>
  );
}

function makeStyles(p: PosterPalette) {
  return StyleSheet.create({
    wrap: { alignItems: 'flex-start' },
    wrapCenter: { alignItems: 'center' },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    rowCenter: { justifyContent: 'center' },
    text: { flexShrink: 1, fontSize: 16, fontWeight: '600', lineHeight: 22 },
    textCenter: { textAlign: 'center' },
    link: { minHeight: FOCUS.minTouch, justifyContent: 'center' },
    linkText: { color: p.gt, fontSize: 16, fontWeight: '700', textDecorationLine: 'underline' },
  });
}
