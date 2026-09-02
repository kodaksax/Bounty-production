// app/(admin)/support/help.tsx - Admin Help Center
//
// Rewritten. The previous version listed 15 article stubs — a title and a
// one-line summary each — and every one of them opened the same hardcoded body:
// "This is a placeholder for the full article content. In a production
// environment, this would contain detailed documentation..." followed by five
// generic bullets ("Understanding the feature", "Best practices", ...). The
// "Was this article helpful?" thumbs had no onPress at all.
//
// Several of the stub titles also described things the console does not do
// ("Handling Flagged Content" — there is no flag column or flag queue;
// "Refund Process" — refunds are issued through Stripe, not from this console),
// so filling them in would have documented features that do not exist.
//
// This is a smaller, accurate set of operator notes written from what the
// console actually does, with each note linking to the screen it describes.
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { AdminHeader } from '../../../components/admin/AdminHeader';
import {
  AdminEmpty,
  AdminPanel,
  AdminScreen,
  AdminSearchBar,
  AdminSection,
  withAlpha,
} from '../../../components/admin/AdminUI';
import { useAppTheme } from '../../../hooks/use-app-theme';
import { ROUTES } from '../../../lib/routes';

type IconName = keyof typeof MaterialIcons.glyphMap;

interface HelpNote {
  id: string;
  title: string;
  summary: string;
  /** Paragraphs of real, verified guidance. */
  body: string[];
  /** Screen this note is about, if any. */
  route?: string;
  routeLabel?: string;
}

interface HelpSection {
  id: string;
  title: string;
  icon: IconName;
  notes: HelpNote[];
}

const HELP_SECTIONS: HelpSection[] = [
  {
    id: 'orientation',
    title: 'Orientation',
    icon: 'explore',
    notes: [
      {
        id: 'dashboard',
        title: 'What the dashboard tells you',
        summary: 'The "Needs attention" band is the queue that matters',
        body: [
          'The dashboard opens with a "Needs attention" band. It only lists queues that are non-empty: open disputes, failed transactions, pending reports and pending withdrawals. If the band says everything is clear, there is genuinely nothing waiting in those four queues.',
          'Below it, the headline tiles and the bounty status breakdown are server-side counts taken at page load, not estimates. The breakdown covers all seven bounty statuses, so the individual rows add up to the total.',
          '"Escrow held" is money the platform is currently holding on behalf of users: everything ever funded into escrow, less what has since been released or refunded. "Escrow lifetime" is the gross funded figure and will only ever go up.',
        ],
        route: ROUTES.ADMIN.INDEX,
        routeLabel: 'Open dashboard',
      },
      {
        id: 'search',
        title: 'Finding a specific record',
        summary: 'Search, filters and paging on the list screens',
        body: [
          'Bounties, Users and Transactions each have a search box and filter chips. Search is server-side and matches: bounty title/description, username/display name/email, and transaction description/Stripe reference.',
          'Lists load one page at a time. The footer shows how many of the filtered total are on screen and offers "Load more"; the page size is set under Settings → Console preferences.',
          'If you have a record id, the fastest route is usually a related screen: a transaction links to its bounty and both counterparties, and a bounty links to its poster, hunter, applications, ledger, submissions and disputes.',
        ],
        route: ROUTES.ADMIN.BOUNTIES,
        routeLabel: 'Open bounties',
      },
    ],
  },
  {
    id: 'moderation',
    title: 'Moderation',
    icon: 'gavel',
    notes: [
      {
        id: 'account-status',
        title: 'Suspending, banning and restoring accounts',
        summary: 'Every status change needs a reason and is audited',
        body: [
          'Account status changes are made from a user detail screen. Suspend removes access until restored; Ban is the permanent form; Restore returns the account to active.',
          'A reason is required. It is written to admin_action_log together with your admin id and the old and new status, and it appears in the audit log under the "user" category.',
          'The change is applied by a service-role Edge Function that re-verifies your admin role server-side. If it fails, the screen tells you and the status on screen stays as it was — it is never optimistically flipped.',
        ],
        route: ROUTES.ADMIN.USERS,
        routeLabel: 'Open users',
      },
      {
        id: 'bounty-removal',
        title: 'Removing a bounty',
        summary: 'Archiving for a guideline violation, with or without a warning',
        body: [
          '"Remove for violation" on a bounty detail screen archives the bounty so it no longer appears in the marketplace. You choose a violation reason first.',
          '"Remove + warn poster" additionally records a warning against the poster in admin_warnings. If the removal succeeds but the warning fails, the screen says so explicitly rather than reporting a blanket success — the bounty is gone but the poster was not told.',
          'Removal does not move money. If the bounty has escrow against it, settle that separately from the Transactions screen or through the dispute flow.',
        ],
      },
      {
        id: 'status-vs-money',
        title: 'Status changes never move money',
        summary: 'Lifecycle state and escrow are separate',
        body: [
          'The status buttons on a bounty detail screen change the bounty’s lifecycle state only. Marking a bounty "completed" here does not release escrow to the hunter.',
          'Escrow release runs through the completion flow, which the poster drives in the app; refunds and dispute outcomes run through their own flows. This separation is deliberate: those paths carry the payment side effects and their audit trail.',
          'If you need money to move, use Transactions, Withdrawal Recovery or Disputes — not a status flip.',
        ],
      },
    ],
  },
  {
    id: 'money',
    title: 'Money',
    icon: 'account-balance',
    notes: [
      {
        id: 'ledger',
        title: 'Reading the wallet ledger',
        summary: 'Transaction types and what each one means',
        body: [
          'Transactions are the wallet ledger. escrow is money funded into escrow by a poster; release is money paid out to a hunter on completion; refund returns escrow to the poster; deposit and withdrawal move money between a user and their bank; dispute_loss and admin_adjustment are corrections.',
          'A row can be pending, completed, failed or manually_paid. Failed and pending rows are marked with a coloured left edge so they stand out from the settled ones.',
          'The ledger is read-only in this console. Every row links to its bounty and to both counterparties.',
        ],
        route: ROUTES.ADMIN.TRANSACTIONS,
        routeLabel: 'Open transactions',
      },
      {
        id: 'stuck-payouts',
        title: 'Stuck payouts',
        summary: 'Where to go when a withdrawal fails',
        body: [
          'Withdrawal Recovery is the screen for payouts that failed or never completed. It can force a retry or record a manual settlement, and every action is written to admin_action_log.',
          'Balance Reconciliation compares ledger balances against Stripe and lists findings from the scheduled reconciliation job. Use it when a user’s balance looks wrong rather than adjusting anything by hand.',
        ],
        route: ROUTES.ADMIN.WITHDRAWAL_RECOVERY,
        routeLabel: 'Open withdrawal recovery',
      },
    ],
  },
  {
    id: 'records',
    title: 'Records',
    icon: 'history',
    notes: [
      {
        id: 'audit',
        title: 'What the audit log contains',
        summary: 'Four real sources, and what is not covered',
        body: [
          'The audit log is assembled from four tables: admin_action_log (account status changes and withdrawal operations), dispute_audit_log (dispute lifecycle), admin_warnings (warnings issued) and payout_audit_log (payout decisions and failures).',
          'Only recorded actions appear. Categories with no backing table show nothing rather than filler — an empty category means the platform does not record that kind of event yet, not that nothing happened.',
          'If a source cannot be read at all, the screen says so above the list. Treat an empty list without that banner as a genuine absence of activity.',
        ],
        route: ROUTES.ADMIN.AUDIT_LOGS,
        routeLabel: 'Open audit log',
      },
      {
        id: 'permissions',
        title: 'How admin access is enforced',
        summary: 'The server decides, not this app',
        body: [
          'Admin access comes from the role claim in your JWT’s app_metadata, which only the server can set — it is not something the app can grant itself.',
          'Every admin read and write is enforced by Postgres row-level security or by a service-role Edge Function that re-verifies that claim. The redirect that keeps non-admins out of this section is a convenience, not the security boundary.',
          'This means a hidden button is never what stops an unauthorised action; the server rejects it regardless.',
        ],
        route: ROUTES.ADMIN.SETTINGS.SECURITY,
        routeLabel: 'Open security',
      },
    ],
  },
];

export default function AdminHelpCenterScreen() {
  const { theme } = useAppTheme();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [openNote, setOpenNote] = useState<string | null>(null);

  const query = search.trim().toLowerCase();
  const sections = useMemo(() => {
    if (!query) return HELP_SECTIONS;
    return HELP_SECTIONS.map((section) => ({
      ...section,
      notes: section.notes.filter(
        (note) =>
          note.title.toLowerCase().includes(query) ||
          note.summary.toLowerCase().includes(query) ||
          note.body.some((paragraph) => paragraph.toLowerCase().includes(query))
      ),
    })).filter((section) => section.notes.length > 0);
  }, [query]);

  return (
    <AdminScreen>
      <AdminHeader title="Help" showBack backFallback={ROUTES.ADMIN.SUPPORT.INDEX} />

      <AdminSearchBar value={search} onChangeText={setSearch} placeholder="Search operator notes…" />

      <ScrollView contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 48 }}>
        {sections.length === 0 ? (
          <AdminEmpty
            icon="search-off"
            title="No notes match"
            description={`Nothing in the operator notes mentions "${search.trim()}".`}
            actionLabel="Clear search"
            onAction={() => setSearch('')}
          />
        ) : (
          sections.map((section) => (
            <AdminSection key={section.id} title={section.title}>
              <AdminPanel style={{ paddingVertical: 0 }}>
                {section.notes.map((note, index) => {
                  const expanded = openNote === note.id;
                  return (
                    <View
                      key={note.id}
                      style={{
                        borderBottomWidth:
                          index === section.notes.length - 1 ? 0 : StyleSheet.hairlineWidth,
                        borderBottomColor: theme.border,
                        paddingVertical: theme.spacing.md,
                      }}
                    >
                      <TouchableOpacity
                        style={styles.noteHeader}
                        onPress={() => setOpenNote(expanded ? null : note.id)}
                        accessibilityRole="button"
                        accessibilityState={{ expanded }}
                        accessibilityLabel={note.title}
                      >
                        <View
                          style={[
                            styles.noteIcon,
                            {
                              backgroundColor: withAlpha(theme.primary, 0.12),
                              borderRadius: theme.radius.md,
                            },
                          ]}
                        >
                          <MaterialIcons name={section.icon} size={18} color={theme.primary} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 15, fontWeight: '600', color: theme.text }}>
                            {note.title}
                          </Text>
                          <Text
                            style={{ fontSize: 12, color: theme.textSecondary, marginTop: 2 }}
                            numberOfLines={expanded ? undefined : 1}
                          >
                            {note.summary}
                          </Text>
                        </View>
                        <MaterialIcons
                          name={expanded ? 'expand-less' : 'expand-more'}
                          size={22}
                          color={theme.textSecondary}
                        />
                      </TouchableOpacity>

                      {expanded ? (
                        <View style={{ paddingTop: theme.spacing.md, gap: theme.spacing.md }}>
                          {note.body.map((paragraph, i) => (
                            <Text
                              key={i}
                              style={{ fontSize: 14, color: theme.text, lineHeight: 21 }}
                            >
                              {paragraph}
                            </Text>
                          ))}
                          {note.route ? (
                            <TouchableOpacity
                              style={styles.noteLink}
                              onPress={() => router.push(note.route as never)}
                              accessibilityRole="link"
                              accessibilityLabel={note.routeLabel ?? 'Open screen'}
                            >
                              <Text style={{ fontSize: 13, fontWeight: '600', color: theme.primary }}>
                                {note.routeLabel ?? 'Open screen'}
                              </Text>
                              <MaterialIcons name="arrow-forward" size={16} color={theme.primary} />
                            </TouchableOpacity>
                          ) : null}
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </AdminPanel>
            </AdminSection>
          ))
        )}

        {/* Replaces the dead "Was this article helpful?" thumbs, which had no
            handler and nowhere to record an answer. */}
        <AdminSection title="Something missing?">
          <AdminPanel onPress={() => router.push(ROUTES.ADMIN.SUPPORT.FEEDBACK as never)}>
            <View style={styles.noteHeader}>
              <MaterialIcons name="feedback" size={20} color={theme.primary} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 15, fontWeight: '600', color: theme.text }}>
                  Send feedback
                </Text>
                <Text style={{ fontSize: 12, color: theme.textSecondary, marginTop: 2 }}>
                  Report a bug or request a feature. It goes to the same queue as in-app feedback.
                </Text>
              </View>
              <MaterialIcons name="chevron-right" size={20} color={theme.textSecondary} />
            </View>
          </AdminPanel>
        </AdminSection>
      </ScrollView>
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
  noteHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  noteIcon: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noteLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
  },
});
