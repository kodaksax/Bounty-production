/**
 * "Get help with this job": every way out of a problem on this job, in the
 * poster's words, on one sheet. Rows depend on where the job is, so a poster
 * is never offered something that can't apply (no "cancel" once someone is
 * working, no "they didn't reply" before anyone was chosen).
 *
 * Each row routes to the screen that already owns that action: the report
 * flow (/bounty/[id]/dispute, reason preselected), the review sheet, the
 * take-down confirmation on the job page, or the support form. Nothing here
 * moves money. "Where is my money?" answers in place, from the same money
 * sentence the job page shows, so the two can never disagree.
 *
 * "Have Bounty help me" opens the support form with the request already
 * written as "please help me manage this job". It promises a reply by email,
 * which is what the support form already says, and nothing more: there is no
 * staffed concierge process to promise yet.
 */
import { MaterialIcons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';

export type HelpRoute =
  | 'message'
  | 'no_show'
  | 'missed_time'
  | 'ask_to_finish'
  | 'work_quality'
  | 'cancel_open'
  | 'cancel_hired'
  | 'see_report'
  | 'assist'
  | 'support';

export interface GetHelpContext {
  helperName: string | null;
  /** Someone has been chosen and the job isn't finished. */
  hired: boolean;
  /** Open and nobody chosen: the poster can take it down themselves. */
  canTakeDown: boolean;
  /** The chosen person says it's finished and it waits on the poster. */
  awaitingApproval: boolean;
  hasDispute: boolean;
  completed: boolean;
  /** The job page's own money sentence, so both always agree. */
  moneyLine: string | null;
}

interface Props extends GetHelpContext {
  visible: boolean;
  onClose: () => void;
  onRoute: (route: HelpRoute) => void;
}

interface Row {
  route: HelpRoute | 'money';
  icon: keyof typeof MaterialIcons.glyphMap;
  title: string;
  detail: string;
}

export function buildHelpRows(ctx: GetHelpContext): Row[] {
  const name = ctx.helperName?.trim() || null;
  const them = name ?? 'they';
  const rows: Row[] = [];

  if (ctx.hasDispute) {
    rows.push({
      route: 'see_report',
      icon: 'assignment',
      title: 'See the problem you reported',
      detail: 'What you told us, and where it stands now.',
    });
  }

  if (name && ctx.hired && !ctx.completed) {
    rows.push({
      route: 'message',
      icon: 'chat-bubble-outline',
      title: `Message ${name}`,
      detail: 'Agree a time, ask a question, or check how it is going.',
    });
  }

  if (ctx.hired && !ctx.completed && !ctx.hasDispute) {
    if (ctx.awaitingApproval) {
      rows.push({
        route: 'ask_to_finish',
        icon: 'assignment-return',
        title: "The job isn't finished",
        detail: `Ask ${them} to finish it before you approve. Nothing is paid in the meantime.`,
      });
      rows.push({
        route: 'work_quality',
        icon: 'report-problem',
        title: "The work wasn't done properly",
        detail: 'Tell us what is wrong. Nobody is paid while we look into it.',
      });
    } else {
      rows.push({
        route: 'no_show',
        icon: 'person-off',
        title: `${name ?? 'They'} hasn't replied or didn't turn up`,
        detail: "Tell us and we'll contact them. If they can't do the job, we'll sort out your money.",
      });
      rows.push({
        route: 'missed_time',
        icon: 'schedule',
        title: 'They missed the time we agreed',
        detail: 'We look at what you agreed in your messages and sort it out.',
      });
    }
    rows.push({
      route: 'cancel_hired',
      icon: 'cancel',
      title: 'I want to cancel this job',
      detail: `You've already chosen ${them}, so tell us and we'll sort it out with them.`,
    });
  }

  if (ctx.canTakeDown) {
    rows.push({
      route: 'cancel_open',
      icon: 'cancel',
      title: "I don't need this done any more",
      detail: "Take the job down. You haven't chosen anyone yet.",
    });
  }

  if (ctx.moneyLine) {
    rows.push({
      route: 'money',
      icon: 'account-balance-wallet',
      title: 'Where is my money?',
      detail: 'See what you have paid and who has it.',
    });
  }

  rows.push({
    route: 'assist',
    icon: 'volunteer-activism',
    title: 'Have Bounty help me with this job',
    detail: 'Ask a person on our team to help you choose someone, keep in touch with them, or sort out a problem.',
  });
  rows.push({
    route: 'support',
    icon: 'support-agent',
    title: 'Write to a person at Bounty',
    detail: 'About anything else. We reply by email, and this job is attached for you.',
  });
  return rows;
}

export function GetHelpSheet({ visible, onClose, onRoute, ...ctx }: Props) {
  const { theme } = useAppThemeContext();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const [showMoney, setShowMoney] = useState(false);
  const rows = buildHelpRows(ctx);
  if (!visible) return null;

  const close = () => {
    setShowMoney(false);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close} presentationStyle="pageSheet">
      <View style={[s.root, { paddingTop: insets.top + 8 }]} testID="get-help-sheet">
        <View style={s.header}>
          <Text style={s.title} accessibilityRole="header">
            Get help with this job
          </Text>
          <TouchableOpacity
            onPress={close}
            style={s.close}
            accessibilityRole="button"
            accessibilityLabel="Close"
            testID="get-help-close"
          >
            <MaterialIcons name="close" size={28} color={theme.text} />
            <Text style={s.closeText}>Close</Text>
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={[s.list, { paddingBottom: insets.bottom + 24 }]}>
          {rows.map(r => (
            <View key={r.route}>
              <TouchableOpacity
                style={s.row}
                onPress={() => {
                  if (r.route === 'money') {
                    setShowMoney(v => !v);
                    return;
                  }
                  setShowMoney(false);
                  onRoute(r.route);
                }}
                accessibilityRole="button"
                accessibilityLabel={`${r.title}. ${r.detail}`}
                accessibilityState={r.route === 'money' ? { expanded: showMoney } : undefined}
                testID={`get-help-${r.route}`}
              >
                <MaterialIcons name={r.icon} size={26} color={theme.primaryLight} />
                <View style={s.rowText}>
                  <Text style={s.rowTitle}>{r.title}</Text>
                  <Text style={s.rowDetail}>{r.detail}</Text>
                </View>
                <MaterialIcons
                  name={r.route === 'money' ? (showMoney ? 'expand-less' : 'expand-more') : 'chevron-right'}
                  size={24}
                  color={theme.textSecondary}
                />
              </TouchableOpacity>
              {r.route === 'money' && showMoney ? (
                <View style={s.moneyAnswer} testID="get-help-money-answer" accessibilityLiveRegion="polite">
                  <Text style={s.moneyText}>{ctx.moneyLine}</Text>
                  <Text style={s.moneyDetail}>
                    {ctx.hired || ctx.completed
                      ? 'The person you chose is paid when you approve the work. If you report a problem, nobody is paid while our support team looks into it.'
                      : 'Whoever you choose is paid only when you approve their work. If you report a problem, nobody is paid while our support team looks into it.'}
                  </Text>
                </View>
              ) : null}
            </View>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: t.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 20,
      paddingBottom: 12,
      gap: 12,
    },
    title: { flex: 1, color: t.text, fontSize: 24, fontWeight: '800' },
    close: { minHeight: 48, minWidth: 48, flexDirection: 'row', alignItems: 'center', gap: 4 },
    closeText: { color: t.text, fontSize: 16, fontWeight: '600' },
    list: { paddingHorizontal: 16, gap: 10 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      minHeight: 72,
      padding: 16,
      borderRadius: 16,
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.borderSubtle,
    },
    rowText: { flex: 1, gap: 4 },
    rowTitle: { color: t.text, fontSize: 18, fontWeight: '700', lineHeight: 24 },
    rowDetail: { color: t.textSecondary, fontSize: 16, lineHeight: 22 },
    moneyAnswer: {
      marginTop: 6,
      padding: 16,
      borderRadius: 14,
      backgroundColor: t.surfaceSecondary,
      gap: 8,
    },
    moneyText: { color: t.text, fontSize: 17, lineHeight: 24, fontWeight: '600' },
    moneyDetail: { color: t.text, fontSize: 16, lineHeight: 23 },
  });
}
