/**
 * "You've chosen Marcus." The screen a poster sees once a hire has actually
 * gone through.
 *
 * Why it exists: in the 14 Nov senior audit a persona tapped Hire, watched a
 * spinner, and gave up not knowing whether she had hired anyone, though the
 * hire had saved. The chat answered with a small card, and the hook behind it
 * resolved the same way for success and failure.
 *
 * It is only ever rendered from an AcceptRequestOutcome with accepted: true,
 * which useAcceptRequest returns only after fn_accept_bounty_request answered
 * with the accepted row. It makes no claim about money it can't back: the
 * one money line is the rule that holds in every payment architecture (the
 * person is paid only after the poster approves).
 */
import { MaterialIcons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';

interface Props {
  visible: boolean;
  helperName: string;
  isForHonor: boolean;
  /** Opens the conversation with the chosen person. */
  onMessage: () => void;
  /** Closes the confirmation and stays on (or returns to) the job page. */
  onDone: () => void;
  isOpeningMessage?: boolean;
  /** Label for the secondary button; the chat says "Back to the chat". */
  doneLabel?: string;
}

export function HireConfirmation({
  visible,
  helperName,
  isForHonor,
  onMessage,
  onDone,
  isOpeningMessage = false,
  doneLabel = 'Back to my job',
}: Props) {
  const { theme } = useAppThemeContext();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const name = helperName.trim() || 'the person you chose';
  if (!visible) return null;

  const steps = [
    `Send ${name} a message.`,
    'Agree on a day and time for the work.',
    `${name} does the job and tells you when it's finished.`,
    isForHonor ? 'You check the work and mark it done.' : 'You check the work and approve the payment.',
  ];

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onDone} presentationStyle="fullScreen">
      <View style={[s.root, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 16 }]} testID="hire-confirmation">
        <ScrollView contentContainerStyle={s.scroll}>
          <View style={s.badge} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <MaterialIcons name="check" size={44} color={theme.onPrimary} />
          </View>
          <Text style={s.title} accessibilityRole="header" accessibilityLiveRegion="assertive">
            {`You've chosen ${name}`}
          </Text>
          <Text style={s.lead}>
            {`${name} has been told they have the job. The other offers are closed.`}
          </Text>

          <Text style={s.subhead} accessibilityRole="header">
            {"Here's what happens next"}
          </Text>
          <View style={s.steps}>
            {steps.map((text, i) => (
              <View key={i} style={s.stepRow} accessible accessibilityLabel={`Step ${i + 1}. ${text}`}>
                <View style={s.stepNum}>
                  <Text style={s.stepNumText}>{i + 1}</Text>
                </View>
                <Text style={s.stepText}>{text}</Text>
              </View>
            ))}
          </View>

          {!isForHonor ? (
            <View style={s.moneyRow}>
              <MaterialIcons name="lock-outline" size={20} color={theme.textSecondary} />
              <Text style={s.moneyText}>
                {`${name} is paid only after you approve the work. Your job page always shows where your money is.`}
              </Text>
            </View>
          ) : null}
        </ScrollView>

        <View style={s.actions}>
          <TouchableOpacity
            style={[s.primaryBtn, isOpeningMessage && s.busy]}
            onPress={onMessage}
            disabled={isOpeningMessage}
            accessibilityRole="button"
            accessibilityLabel={`Message ${name}`}
            accessibilityState={{ busy: isOpeningMessage }}
            testID="hire-confirmation-message"
          >
            {isOpeningMessage ? (
              <ActivityIndicator color={theme.onPrimary} />
            ) : (
              <>
                <MaterialIcons name="chat-bubble-outline" size={22} color={theme.onPrimary} />
                <Text style={s.primaryBtnText}>{`Message ${name}`}</Text>
              </>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={s.secondaryBtn}
            onPress={onDone}
            accessibilityRole="button"
            accessibilityLabel={doneLabel}
            testID="hire-confirmation-done"
          >
            <Text style={s.secondaryBtnText}>{doneLabel}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: t.background, paddingHorizontal: 20 },
    scroll: { gap: 16, paddingBottom: 16 },
    badge: {
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor: t.primary,
      alignItems: 'center',
      justifyContent: 'center',
      alignSelf: 'center',
      marginBottom: 4,
    },
    title: { color: t.text, fontSize: 28, fontWeight: '800', lineHeight: 34, textAlign: 'center' },
    lead: { color: t.text, fontSize: 18, lineHeight: 26, textAlign: 'center' },
    subhead: { color: t.text, fontSize: 20, fontWeight: '800', marginTop: 8 },
    steps: { gap: 12 },
    stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
    stepNum: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: t.primaryTint,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepNumText: { color: t.primaryLight, fontSize: 17, fontWeight: '800' },
    stepText: { flex: 1, color: t.text, fontSize: 17, lineHeight: 25, paddingTop: 3 },
    moneyRow: {
      flexDirection: 'row',
      gap: 10,
      alignItems: 'flex-start',
      backgroundColor: t.surfaceSecondary,
      borderRadius: 12,
      padding: 14,
      marginTop: 4,
    },
    moneyText: { flex: 1, color: t.text, fontSize: 17, lineHeight: 24 },
    actions: { gap: 10, paddingTop: 8 },
    primaryBtn: {
      minHeight: 56,
      borderRadius: 14,
      backgroundColor: t.primary,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      paddingHorizontal: 16,
    },
    busy: { opacity: 0.8 },
    primaryBtnText: { color: t.onPrimary, fontSize: 19, fontWeight: '700' },
    secondaryBtn: {
      minHeight: 52,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    secondaryBtnText: { color: t.text, fontSize: 17, fontWeight: '600' },
  });
}
