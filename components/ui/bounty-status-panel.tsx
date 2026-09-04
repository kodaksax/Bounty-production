/**
 * The one place bounty state is explained to a user.
 *
 * Every management surface — the poster dashboard, the hunter flow screens, the
 * expandable list card — renders this instead of writing its own sentence, so a
 * poster and a hunter looking at the same bounty always read two consistent
 * halves of the same story. The copy itself comes from
 * lib/utils/bounty-lifecycle.ts, which derives it from backend state; this
 * component only decides how it looks.
 *
 * Three variants:
 *  - `panel`   full treatment for a detail screen: headline, explanation, next
 *              step, primary action, and secondary actions behind a disclosure.
 *  - `banner`  headline + next step + primary action, no disclosure. For the
 *              top of a flow screen that already has its own action buttons.
 *  - `inline`  a single line ("Waiting on you · Review the work") for list rows,
 *              where the card badge already carries the status.
 */
import { MaterialIcons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';
import type {
  BountyActionKey,
  BountyLifecycleState,
  BountyLifecycleTone,
  BountyRole,
} from '../../lib/utils/bounty-lifecycle';
import { getWaitingOnLabel } from '../../lib/utils/bounty-lifecycle';

export interface BountyStatusPanelProps {
  state: BountyLifecycleState;
  role: BountyRole;
  otherPartyName?: string | null;
  variant?: 'panel' | 'banner' | 'inline';
  /**
   * Handlers keyed by action. An action with no handler is not rendered — that
   * is how a screen opts out of an action it cannot perform (e.g. the list card
   * has no "leave a review" flow) without the lifecycle needing to know.
   */
  onAction?: Partial<Record<BountyActionKey, () => void>>;
  /** Set while an action is running so the primary button can't be double-fired. */
  busyAction?: BountyActionKey | null;
  /** Extra content rendered between the explanation and the actions. */
  children?: React.ReactNode;
}

/** Semantic tone -> theme colors. Kept here so the lifecycle stays theme-free. */
function toneColors(theme: AppTheme, tone: BountyLifecycleTone) {
  switch (tone) {
    case 'action':
      return { accent: theme.warning, tint: withAlpha(theme.warning, theme.isDark ? 0.14 : 0.1) };
    case 'positive':
      return { accent: theme.success, tint: withAlpha(theme.success, theme.isDark ? 0.14 : 0.1) };
    case 'warning':
      return { accent: theme.error, tint: withAlpha(theme.error, theme.isDark ? 0.14 : 0.1) };
    case 'progress':
      return { accent: theme.primary, tint: withAlpha(theme.primary, theme.isDark ? 0.14 : 0.1) };
    default:
      return { accent: theme.textSecondary, tint: theme.surfaceSecondary };
  }
}

/**
 * Theme colors are authored as 6-digit hex; anything else (rgba from a custom
 * theme) is passed through untinted rather than producing an invalid color.
 */
function withAlpha(color: string, alpha: number): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) return color;
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function BountyStatusPanel({
  state,
  role,
  otherPartyName,
  variant = 'panel',
  onAction,
  busyAction,
  children,
}: BountyStatusPanelProps) {
  const { theme } = useAppThemeContext();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [moreOpen, setMoreOpen] = useState(false);

  const { accent, tint } = toneColors(theme, state.tone);
  const waitingLabel = getWaitingOnLabel(state.waitingOn, role, otherPartyName);

  // Only actions the host screen actually wired up are offered. A primary
  // action with no handler degrades to the first available secondary rather
  // than rendering a button that does nothing.
  const available = (key: BountyActionKey) => typeof onAction?.[key] === 'function';
  const primary =
    state.primaryAction && available(state.primaryAction.key) ? state.primaryAction : null;
  const secondary = state.secondaryActions.filter(a => available(a.key) && a.key !== primary?.key);

  if (variant === 'inline') {
    return (
      <View style={styles.inlineRow} accessibilityRole="summary">
        <View style={[styles.dot, { backgroundColor: accent }]} />
        <Text style={styles.inlineText} numberOfLines={2}>
          <Text style={[styles.inlineStrong, { color: accent }]}>
            {waitingLabel ?? state.headline}
          </Text>
          {state.nextStep ? ` · ${state.nextStep}` : ''}
        </Text>
      </View>
    );
  }

  return (
    <View
      style={[styles.card, { backgroundColor: tint, borderColor: withAlpha(accent, 0.35) }]}
      accessibilityRole="summary"
      accessibilityLabel={`${state.headline}. ${state.explanation} ${state.nextStep}`}
    >
      <View style={styles.headRow}>
        <View style={[styles.iconWrap, { backgroundColor: withAlpha(accent, 0.18) }]}>
          <MaterialIcons
            name={iconForTone(state.tone) as any}
            size={18}
            color={accent}
            accessibilityElementsHidden
          />
        </View>
        <View style={styles.headText}>
          <Text style={styles.headline}>{state.headline}</Text>
          {waitingLabel && (
            <Text style={[styles.waiting, { color: accent }]}>{waitingLabel}</Text>
          )}
        </View>
      </View>

      <Text style={styles.explanation}>{state.explanation}</Text>

      {!!state.nextStep && (
        <View style={styles.nextRow}>
          <MaterialIcons
            name="arrow-forward"
            size={14}
            color={theme.textSecondary}
            accessibilityElementsHidden
          />
          <Text style={styles.nextText}>{state.nextStep}</Text>
        </View>
      )}

      {children}

      {primary && (
        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: accent }]}
          onPress={onAction?.[primary.key]}
          disabled={busyAction === primary.key}
          accessibilityRole="button"
          accessibilityLabel={primary.label}
          accessibilityState={{ disabled: busyAction === primary.key }}
        >
          {busyAction === primary.key ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <MaterialIcons name={primary.icon as any} size={18} color="#ffffff" />
          )}
          <Text style={styles.primaryBtnText}>{primary.label}</Text>
        </TouchableOpacity>
      )}

      {/* Secondary and destructive actions stay collapsed so the primary action
          is never one of five equally-weighted buttons. */}
      {variant === 'panel' && secondary.length > 0 && (
        <View>
          <TouchableOpacity
            style={styles.moreToggle}
            onPress={() => setMoreOpen(o => !o)}
            accessibilityRole="button"
            accessibilityLabel="More actions"
            accessibilityState={{ expanded: moreOpen }}
          >
            <Text style={styles.moreToggleText}>{moreOpen ? 'Fewer actions' : 'More actions'}</Text>
            <MaterialIcons
              name={moreOpen ? 'expand-less' : 'expand-more'}
              size={18}
              color={theme.textSecondary}
            />
          </TouchableOpacity>

          {moreOpen && (
            <View style={styles.moreMenu}>
              {secondary.map(a => (
                <TouchableOpacity
                  key={a.key}
                  style={styles.secondaryBtn}
                  onPress={onAction?.[a.key]}
                  disabled={busyAction === a.key}
                  accessibilityRole="button"
                  accessibilityLabel={a.label}
                >
                  <MaterialIcons
                    name={a.icon as any}
                    size={16}
                    color={a.tone === 'danger' ? theme.error : theme.textSecondary}
                  />
                  <Text
                    style={[
                      styles.secondaryBtnText,
                      a.tone === 'danger' && { color: theme.error },
                    ]}
                  >
                    {a.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

function iconForTone(tone: BountyLifecycleTone): string {
  switch (tone) {
    case 'action':
      return 'pending-actions';
    case 'positive':
      return 'check-circle';
    case 'warning':
      return 'error-outline';
    case 'progress':
      return 'autorenew';
    default:
      return 'info-outline';
  }
}

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    card: {
      borderRadius: 16,
      borderWidth: 1,
      padding: 16,
      gap: 10,
      marginBottom: 16,
    },
    headRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    iconWrap: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headText: {
      flex: 1,
    },
    headline: {
      color: t.text,
      fontSize: 17,
      fontWeight: '700',
    },
    waiting: {
      fontSize: 12,
      fontWeight: '600',
      marginTop: 2,
    },
    explanation: {
      color: t.text,
      fontSize: 14,
      lineHeight: 20,
    },
    nextRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 6,
    },
    nextText: {
      color: t.textSecondary,
      fontSize: 13,
      lineHeight: 18,
      flex: 1,
    },
    primaryBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingVertical: 14,
      borderRadius: 12,
      marginTop: 2,
      minHeight: 48,
    },
    primaryBtnText: {
      color: '#ffffff',
      fontSize: 15,
      fontWeight: '700',
    },
    moreToggle: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      paddingVertical: 10,
      minHeight: 44,
    },
    moreToggleText: {
      color: t.textSecondary,
      fontSize: 13,
      fontWeight: '600',
    },
    moreMenu: {
      gap: 8,
      paddingBottom: 4,
    },
    secondaryBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 12,
      paddingHorizontal: 12,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.surface,
      minHeight: 44,
    },
    secondaryBtnText: {
      color: t.text,
      fontSize: 14,
      fontWeight: '600',
    },
    inlineRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderTopWidth: 1,
      borderTopColor: t.border,
    },
    dot: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },
    inlineText: {
      flex: 1,
      color: t.textSecondary,
      fontSize: 12,
      lineHeight: 17,
    },
    inlineStrong: {
      fontWeight: '700',
    },
  });
}

export default BountyStatusPanel;
