import { MaterialIcons } from '@expo/vector-icons';
import { type Href, useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { analyticsService } from '../../lib/services/analytics-service';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';
import {
  getHunterProfileChecklist,
  type HunterChecklistInput,
  type HunterChecklistItem,
  type HunterChecklistItemId,
} from '../../lib/utils/hunter-profile-checklist';

const ROUTES: Partial<Record<HunterChecklistItemId, Href>> = {
  id_verification: '/verification/onboarding-explainer',
  bio_and_skills: '/profile/edit',
  photo: '/profile/edit',
  payouts: '/wallet/connect/embedded-onboarding',
};

interface HunterProfileChecklistProps {
  input: HunterChecklistInput;
}

/**
 * Own-profile-only, hunter-facing. Ordered steps that make a hunter more
 * appealing to posters (see lib/utils/hunter-profile-checklist.ts for the
 * order and why). Hides itself once every step is done, same as
 * ProfileCompletionMeter.
 */
export function HunterProfileChecklist({ input }: HunterProfileChecklistProps) {
  const { theme } = useAppThemeContext();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const router = useRouter();
  const { items, remaining, isComplete } = getHunterProfileChecklist(input);

  if (isComplete) return null;

  const handlePress = (item: HunterChecklistItem) => {
    const route = ROUTES[item.id];
    if (!route) return;
    analyticsService
      .trackEvent('profile_checklist_item_tapped', { item: item.id, state: item.state })
      .catch(() => {});
    router.push(route);
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.title} accessibilityRole="header">
          Stand out to posters
        </Text>
        {remaining > 0 && (
          <Text style={styles.count}>
            {remaining} step{remaining === 1 ? '' : 's'} left
          </Text>
        )}
      </View>
      {items.map((item) => {
        const done = item.state === 'done';
        const tappable = !done && item.state !== 'in_review' && !!ROUTES[item.id];
        const icon = done
          ? 'check-circle'
          : item.state === 'in_review'
            ? 'hourglass-empty'
            : item.state === 'needs_fix'
              ? 'error-outline'
              : 'radio-button-unchecked';
        const iconColor = done ? theme.success : item.state === 'needs_fix' ? theme.warning : theme.textSecondary;

        return (
          <TouchableOpacity
            key={item.id}
            style={styles.row}
            disabled={!tappable}
            onPress={tappable ? () => handlePress(item) : undefined}
            accessibilityRole={tappable ? 'button' : undefined}
            accessibilityState={{ checked: done, disabled: !tappable }}
            accessibilityLabel={`${item.title}. ${done ? 'Done.' : item.detail}`}
            testID={`hunter-checklist-${item.id}`}
          >
            <MaterialIcons name={icon} size={20} color={iconColor} accessibilityElementsHidden />
            <View style={styles.textWrap}>
              <Text style={[styles.itemTitle, done && styles.itemTitleDone]}>{item.title}</Text>
              {!done && <Text style={styles.itemDetail}>{item.detail}</Text>}
            </View>
            {tappable && (
              <MaterialIcons name="chevron-right" size={20} color={theme.textSecondary} accessibilityElementsHidden />
            )}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
    container: {
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingTop: 14,
      paddingBottom: 4,
      marginTop: 12,
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
    },
    headerRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 4,
    },
    title: {
      fontSize: 15,
      fontWeight: '600',
      color: theme.text,
    },
    count: {
      fontSize: 13,
      fontWeight: '600',
      color: theme.primary,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 10,
      minHeight: 44,
    },
    textWrap: {
      flex: 1,
    },
    itemTitle: {
      fontSize: 14,
      fontWeight: '600',
      color: theme.text,
    },
    itemTitleDone: {
      fontWeight: '400',
      color: theme.textSecondary,
    },
    itemDetail: {
      fontSize: 12,
      marginTop: 2,
      color: theme.textSecondary,
    },
  });
}
