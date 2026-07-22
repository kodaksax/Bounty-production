// components/ui/bounty-workflow-guide.tsx
// Dismissible step-by-step workflow guide for poster and hunter bounty card interactions.
import { MaterialIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState, useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';

type WorkflowVariant = 'poster-postings' | 'poster-requests' | 'hunter-inprogress';

interface WorkflowStep {
  icon: keyof typeof MaterialIcons.glyphMap;
  iconColor: string;
  text: string;
}

interface WorkflowConfig {
  title: string;
  subtitle: string;
  steps: WorkflowStep[];
}

const WORKFLOW_CONFIGS: Record<WorkflowVariant, WorkflowConfig> = {
  'poster-postings': {
    title: '📋 Managing Your Bounties',
    subtitle: "As a poster, here's how to manage your posted bounties:",
    steps: [
      {
        icon: 'touch-app',
        iconColor: '#6ee7b7',
        text: 'Tap any bounty card to expand it and track its progress',
      },
      {
        icon: 'group',
        iconColor: '#6ee7b7',
        text: 'Check the "Requests" tab to see hunters who have applied',
      },
      {
        icon: 'check-circle',
        iconColor: '#6ee7b7',
        text: 'Accept a hunter to lock in the work and place funds in escrow',
      },
      {
        icon: 'rate-review',
        iconColor: '#6ee7b7',
        text: 'When work is submitted, review it under "Review & Verify" in the expanded card',
      },
      {
        icon: 'account-balance-wallet',
        iconColor: '#fcd34d',
        text: 'Approve the work to release payment — or request a revision if needed',
      },
    ],
  },
  'poster-requests': {
    title: '👥 Reviewing Applications',
    subtitle: "Hunters have applied to your bounty. Here's what to do:",
    steps: [
      {
        icon: 'person-search',
        iconColor: '#6ee7b7',
        text: "Review each applicant's profile and application message",
      },
      {
        icon: 'check-circle',
        iconColor: '#6ee7b7',
        text: 'Tap "Accept" on the hunter you\'d like to hire',
      },
      {
        icon: 'lock',
        iconColor: '#fcd34d',
        text: 'Funds are held safely in escrow once you accept — no payment until you approve the work',
      },
      {
        icon: 'chat',
        iconColor: '#6ee7b7',
        text: 'A chat is created automatically so you can coordinate with the hunter',
      },
      {
        icon: 'trending-up',
        iconColor: '#6ee7b7',
        text: 'Track work progress in your "My Postings" tab',
      },
    ],
  },
  'hunter-inprogress': {
    title: '🏹 Completing a Bounty',
    subtitle: "As a hunter, here's how to complete and get paid:",
    steps: [
      {
        icon: 'touch-app',
        iconColor: '#6ee7b7',
        text: 'Tap a bounty card to see details and start working',
      },
      {
        icon: 'chat',
        iconColor: '#6ee7b7',
        text: 'Use the chat to ask questions or update the poster on your progress',
      },
      {
        icon: 'check-circle',
        iconColor: '#6ee7b7',
        text: 'When done, tap "Ready to Submit" to advance to the review step',
      },
      {
        icon: 'attach-file',
        iconColor: '#6ee7b7',
        text: 'Add proof of work (photos, files) and a description of what you completed',
      },
      {
        icon: 'send',
        iconColor: '#6ee7b7',
        text: 'Tap "Submit" — the poster will review and either approve or request revisions',
      },
      {
        icon: 'account-balance-wallet',
        iconColor: '#fcd34d',
        text: 'Once approved, payment is released to your wallet automatically',
      },
    ],
  },
};

interface BountyWorkflowGuideProps {
  variant: WorkflowVariant;
}

/**
 * BountyWorkflowGuide — a dismissible step-by-step guide shown at the top of
 * bounty list tabs to help new users understand the poster/hunter workflow.
 *
 * Dismissed state is stored in component local state (resets per session).
 */
export function BountyWorkflowGuide({ variant }: BountyWorkflowGuideProps) {
  const { theme } = useAppThemeContext();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  // `null` means "loading from storage" so we can avoid flashing the guide
  const [dismissed, setDismissed] = useState<boolean | null>(null);
  const [collapsed, setCollapsed] = useState<boolean | null>(null);

  useEffect(() => {
    let mounted = true;
    const dismissedKey = `BountyWorkflowGuide:dismissed:${variant}`;
    const collapsedKey = `BountyWorkflowGuide:collapsed:${variant}`;

    (async () => {
      try {
        const [rawDismissed, rawCollapsed] = await Promise.all([
          AsyncStorage.getItem(dismissedKey),
          AsyncStorage.getItem(collapsedKey),
        ]);

        if (!mounted) return;

        setDismissed(rawDismissed === 'true' ? true : false);
        setCollapsed(rawCollapsed === 'true' ? true : false);
      } catch (err) {
        if (!mounted) return;
        setDismissed(false);
        setCollapsed(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [variant]);

  // Wait for storage to load to avoid showing the guide briefly for users
  if (dismissed === null || collapsed === null) return null;
  if (dismissed) return null;

  const config = WORKFLOW_CONFIGS[variant];

  return (
    <View style={styles.container}>
      {/* Header row */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <MaterialIcons name="help-outline" size={18} color={theme.primary} />
          <Text style={styles.headerTitle}>{config.title}</Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity
            onPress={() => {
              const next = !(collapsed ?? false);
              setCollapsed(next);
              AsyncStorage.setItem(`BountyWorkflowGuide:collapsed:${variant}`, String(next)).catch(
                () => {}
              );
            }}
            style={styles.iconButton}
            accessibilityRole="button"
            accessibilityLabel={collapsed ? 'Expand guide' : 'Collapse guide'}
            accessibilityHint={collapsed ? 'Show workflow steps' : 'Hide workflow steps'}
          >
            <MaterialIcons
              name={collapsed ? 'expand-more' : 'expand-less'}
              size={20}
              color={theme.primaryLight}
            />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => {
              setDismissed(true);
              AsyncStorage.setItem(`BountyWorkflowGuide:dismissed:${variant}`, 'true').catch(
                () => {}
              );
            }}
            style={styles.iconButton}
            accessibilityRole="button"
            accessibilityLabel="Dismiss guide"
            accessibilityHint="Hide this guide permanently"
          >
            <MaterialIcons name="close" size={18} color={theme.primaryLight} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Steps — hidden when collapsed */}
      {!collapsed && (
        <>
          <Text style={styles.subtitle}>{config.subtitle}</Text>
          <View style={styles.stepsContainer}>
            {config.steps.map((step, index) => (
              <View key={index} style={styles.stepRow}>
                <View style={styles.stepNumber}>
                  <Text style={styles.stepNumberText}>{index + 1}</Text>
                </View>
                <View style={styles.stepIconWrap}>
                  <MaterialIcons name={step.icon} size={16} color={step.iconColor} />
                </View>
                <Text style={styles.stepText}>{step.text}</Text>
              </View>
            ))}
          </View>

          <TouchableOpacity
            style={styles.gotItButton}
            onPress={() => {
              setDismissed(true);
              AsyncStorage.setItem(`BountyWorkflowGuide:dismissed:${variant}`, 'true').catch(
                () => {}
              );
            }}
            accessibilityRole="button"
            accessibilityLabel="Got it, dismiss guide"
          >
            <Text style={styles.gotItText}>Got it!</Text>
            <MaterialIcons name="thumb-up" size={14} color="#052e1b" />
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
    container: {
      backgroundColor: 'rgba(5, 150, 105, 0.15)',
      borderRadius: 14,
      padding: 14,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: theme.border,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 6,
    },
    headerLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      flex: 1,
    },
    headerTitle: {
      color: theme.text,
      fontSize: 15,
      fontWeight: '700',
      flex: 1,
    },
    headerActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    iconButton: {
      padding: 4,
    },
    subtitle: {
      color: theme.textSecondary,
      fontSize: 13,
      lineHeight: 18,
      marginBottom: 10,
    },
    stepsContainer: {
      gap: 8,
      marginBottom: 12,
    },
    stepRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
    },
    stepNumber: {
      width: 20,
      height: 20,
      borderRadius: 10,
      backgroundColor: theme.overlay,
      borderWidth: 1,
      borderColor: 'rgba(110, 231, 183, 0.4)',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
      marginTop: 1,
    },
    stepNumberText: {
      color: theme.primaryLight,
      fontSize: 10,
      fontWeight: '800',
    },
    stepIconWrap: {
      marginTop: 2,
      flexShrink: 0,
    },
    stepText: {
      flex: 1,
      color: theme.text,
      fontSize: 13,
      lineHeight: 19,
    },
    gotItButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      backgroundColor: theme.primary,
      borderRadius: 20,
      paddingVertical: 8,
      paddingHorizontal: 20,
      alignSelf: 'flex-end',
    },
    gotItText: {
      color: '#052e1b',
      fontSize: 13,
      fontWeight: '700',
    },
  });
}
