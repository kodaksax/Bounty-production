/**
 * Focus-first overlays, built on the app's shared AppModal (see
 * docs/MODAL_ANIMATION_STANDARD.md) so they animate, dismiss and avoid the
 * keyboard like every other modal:
 *
 *   PosterSheet   bottom sheet with a handle, title and close button
 *   PosterDialog  centred confirmation card
 *   HelpSheet     the stage-aware "What's going on?" sheet (J, X.3)
 *
 * Focus: when a sheet or dialog opens, screen-reader focus moves to its title;
 * when it closes, focus goes back to whatever opened it (pass `returnFocusRef`).
 * The back button and the backdrop close it unless it is a blocking dialog.
 */
import { MaterialIcons } from '@expo/vector-icons';
import * as React from 'react';
import { useEffect, useMemo, useRef } from 'react';
import { AccessibilityInfo, findNodeHandle, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { IconName } from '../../lib/my-jobs/types';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import { FOCUS, type PosterPalette } from '../../lib/themes/poster-palette';
import { AppModal } from '../ui/app-modal';

function usePosterStyles() {
  const { theme } = useAppThemeContext();
  const p = theme.poster;
  const s = useMemo(() => makeStyles(p), [p]);
  return { p, s };
}

function focusNode(ref: React.RefObject<unknown> | undefined | null) {
  const node = ref?.current ? findNodeHandle(ref.current as never) : null;
  if (node) AccessibilityInfo.setAccessibilityFocus(node);
}

/** Moves focus to `titleRef` on open and back to `returnFocusRef` on close. */
function useModalFocus(
  visible: boolean,
  titleRef: React.RefObject<unknown>,
  returnFocusRef?: React.RefObject<unknown> | null
) {
  const wasVisible = useRef(false);
  useEffect(() => {
    if (visible && !wasVisible.current) {
      const t = setTimeout(() => focusNode(titleRef), 260);
      wasVisible.current = true;
      return () => clearTimeout(t);
    }
    if (!visible && wasVisible.current) {
      wasVisible.current = false;
      const t = setTimeout(() => focusNode(returnFocusRef), 220);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [visible, titleRef, returnFocusRef]);
}

// ── PosterSheet ──────────────────────────────────────────────────────────
export function PosterSheet({
  visible,
  title,
  onClose,
  children,
  returnFocusRef,
  testID,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  returnFocusRef?: React.RefObject<unknown> | null;
  testID?: string;
}) {
  const { p, s } = usePosterStyles();
  const insets = useSafeAreaInsets();
  const titleRef = useRef<Text>(null);
  useModalFocus(visible, titleRef, returnFocusRef);
  return (
    <AppModal visible={visible} onRequestClose={onClose} variant="sheet" accessibilityViewIsModal>
      <View style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 14 }]} testID={testID}>
        <View style={s.handle} />
        <View style={s.sheetHead}>
          <Text ref={titleRef} style={s.sheetTitle} accessibilityRole="header">
            {title}
          </Text>
          <TouchableOpacity
            onPress={onClose}
            style={[s.close, { backgroundColor: p.chip }]}
            accessibilityRole="button"
            accessibilityLabel="Close"
            testID={testID ? `${testID}-close` : undefined}
          >
            <MaterialIcons name="close" size={24} color={p.ink} />
          </TouchableOpacity>
        </View>
        <ScrollView style={s.sheetScroll} contentContainerStyle={s.sheetBody} showsVerticalScrollIndicator={false}>
          {children}
        </ScrollView>
      </View>
    </AppModal>
  );
}

// ── PosterDialog ─────────────────────────────────────────────────────────
export function PosterDialog({
  visible,
  title,
  body,
  onClose,
  children,
  blocking = false,
  returnFocusRef,
  testID,
}: {
  visible: boolean;
  title: string;
  body?: string | null;
  onClose: () => void;
  /** Buttons and any money line. */
  children: React.ReactNode;
  /** A blocking confirmation is closed only by its buttons (and the back button). */
  blocking?: boolean;
  returnFocusRef?: React.RefObject<unknown> | null;
  testID?: string;
}) {
  const { s } = usePosterStyles();
  const titleRef = useRef<Text>(null);
  useModalFocus(visible, titleRef, returnFocusRef);
  return (
    <AppModal visible={visible} onRequestClose={onClose} variant="dialog" dismissable={!blocking} accessibilityViewIsModal>
      <View style={s.dialog} accessibilityRole="alert" testID={testID}>
        <Text ref={titleRef} style={s.dialogTitle} accessibilityRole="header" testID={testID ? `${testID}-title` : undefined}>
          {title}
        </Text>
        {body ? <Text style={s.dialogBody}>{body}</Text> : null}
        {children}
      </View>
    </AppModal>
  );
}

// ── HelpSheet ────────────────────────────────────────────────────────────
export interface HelpOption {
  key: string;
  icon: IconName;
  text: string;
  /** g = talk, w = something is wrong, i = anything else. */
  tone: 'g' | 'w' | 'i';
  onPress: () => void;
}

/**
 * J / X.3. Only the options that make sense for this job's stage and side
 * are passed in (see lib/utils/help-options.ts); "Talk to a person at Bounty"
 * opens the support form. Nothing here promises a reply time.
 */
export function HelpSheet({
  visible,
  onClose,
  subtitle,
  options,
  onTalkToPerson,
  returnFocusRef,
}: {
  visible: boolean;
  onClose: () => void;
  /** "Ada is working on it · $60 held by Bounty". */
  subtitle?: string | null;
  options: HelpOption[];
  onTalkToPerson: () => void;
  returnFocusRef?: React.RefObject<unknown> | null;
}) {
  const { p, s } = usePosterStyles();
  const color = (tone: HelpOption['tone']) => (tone === 'g' ? p.gt : tone === 'i' ? p.it : p.wt);
  return (
    <PosterSheet visible={visible} title={"What's going on?"} onClose={onClose} returnFocusRef={returnFocusRef} testID="help-sheet">
      {subtitle ? <Text style={s.muted}>{subtitle}</Text> : null}
      <View style={s.options}>
        {options.map((option, i) => (
          <TouchableOpacity
            key={option.key}
            onPress={option.onPress}
            style={[s.option, i < options.length - 1 && s.optionDivider]}
            accessibilityRole="button"
            accessibilityLabel={option.text}
            testID={`help-option-${option.key}`}
          >
            <MaterialIcons name={option.icon} size={24} color={color(option.tone)} />
            <Text style={s.optionText}>{option.text}</Text>
            <MaterialIcons name="chevron-right" size={24} color={p.ink2} />
          </TouchableOpacity>
        ))}
      </View>
      <TouchableOpacity
        onPress={onTalkToPerson}
        style={[s.person, { backgroundColor: p.ink }]}
        accessibilityRole="button"
        accessibilityLabel="Talk to a person at Bounty"
        testID="help-option-support"
      >
        <MaterialIcons name="support-agent" size={24} color={p.card} />
        <Text style={[s.personText, { color: p.card }]}>Talk to a person at Bounty</Text>
        <MaterialIcons name="chevron-right" size={24} color={p.card} />
      </TouchableOpacity>
    </PosterSheet>
  );
}

function makeStyles(p: PosterPalette) {
  return StyleSheet.create({
    sheet: {
      backgroundColor: p.card,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      paddingTop: 10,
      paddingHorizontal: 20,
      maxHeight: '92%',
    },
    handle: { width: 40, height: 5, borderRadius: 3, backgroundColor: p.line, alignSelf: 'center' },
    sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 10, marginBottom: 6 },
    sheetTitle: { flex: 1, color: p.ink, fontSize: FOCUS.sheetTitle, fontWeight: '800', lineHeight: 29 },
    close: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
    sheetScroll: { flexGrow: 0 },
    sheetBody: { gap: 14, paddingBottom: 8 },
    dialog: { backgroundColor: p.card, borderRadius: 24, padding: 24, gap: 16 },
    dialogTitle: { color: p.ink, fontSize: FOCUS.flowTitle, fontWeight: '800', lineHeight: 32, letterSpacing: -0.3 },
    dialogBody: { color: p.ink2, fontSize: 17, lineHeight: 25 },
    muted: { color: p.ink2, fontSize: 17, lineHeight: 25 },
    options: { borderWidth: 1, borderColor: p.line, borderRadius: 18, overflow: 'hidden' },
    option: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 64, paddingLeft: 16, paddingRight: 14, backgroundColor: p.card },
    optionDivider: { borderBottomWidth: 1, borderBottomColor: p.line },
    optionText: { flex: 1, color: p.ink, fontSize: 17, fontWeight: '600', lineHeight: 23 },
    person: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 64, paddingHorizontal: 16, borderRadius: 16 },
    personText: { flex: 1, fontSize: 17, fontWeight: '700' },
  });
}
