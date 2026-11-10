/**
 * "Need this done? Post it as a bounty". Search's offer to turn a query
 * that reads like a job request into a bounty (see
 * lib/utils/search-post-fallback.ts).
 *
 * Two sizes. `prominent` stands in for the empty results ("No bounties
 * found"), where it is the only way forward. `compact` sits under real
 * results as a quieter second option.
 *
 * Built for large system font: no text here caps its font scale, every line
 * wraps instead of truncating, and nothing sits side by side that could
 * squeeze, so it still reads at 200% on a phone. The button keeps a 48 dp
 * minimum and grows with its label.
 */

import { MaterialIcons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SIZING, SPACING } from '../../lib/constants/accessibility';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';

export const POST_FROM_SEARCH_HEADING = 'Need this done? Post it as a bounty';
export const POST_FROM_SEARCH_BUTTON = 'Post this';

/** No text in the card is allowed below this size. */
export const POST_FROM_SEARCH_MIN_FONT = 16;

export type PostFromSearchCardVariant = 'prominent' | 'compact';

interface PostFromSearchCardProps {
  /** The draft title the query becomes, quoted back to the poster. */
  title: string;
  variant: PostFromSearchCardVariant;
  onPost: () => void;
  /** True while the draft is being written, so a second tap can't race it. */
  busy?: boolean;
}

export function PostFromSearchCard({ title, variant, onPost, busy = false }: PostFromSearchCardProps) {
  const { theme } = useAppThemeContext();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const prominent = variant === 'prominent';

  return (
    <View
      style={[s.card, prominent ? s.cardProminent : s.cardCompact]}
      testID={`post-from-search-card-${variant}`}
    >
      <View style={s.headingRow}>
        <MaterialIcons
          name="add-task"
          size={prominent ? 24 : 20}
          color={theme.primaryLight}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
        <Text style={[s.heading, prominent && s.headingProminent]} accessibilityRole="header">
          {POST_FROM_SEARCH_HEADING}
        </Text>
      </View>

      <Text style={s.quote} testID="post-from-search-quote">
        {`“${title}”`}
      </Text>

      {prominent && (
        <Text style={s.note}>No bounties match this yet.</Text>
      )}

      <TouchableOpacity
        onPress={onPost}
        disabled={busy}
        style={[s.button, busy && s.buttonBusy]}
        accessibilityRole="button"
        accessibilityLabel={`${POST_FROM_SEARCH_BUTTON}: ${title}`}
        accessibilityHint="Opens a new bounty with this as its title"
        accessibilityState={{ disabled: busy, busy }}
        testID="post-from-search-button"
      >
        <Text style={s.buttonLabel}>{POST_FROM_SEARCH_BUTTON}</Text>
      </TouchableOpacity>
    </View>
  );
}

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    card: {
      backgroundColor: t.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: t.primary,
      gap: SPACING.COMPACT_GAP,
    },
    cardProminent: {
      padding: SPACING.CARD_PADDING,
      marginBottom: SPACING.ELEMENT_GAP,
    },
    cardCompact: {
      padding: SPACING.ELEMENT_GAP,
      marginTop: SPACING.COMPACT_GAP,
    },
    headingRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: SPACING.COMPACT_GAP,
    },
    heading: {
      flex: 1,
      color: t.text,
      fontSize: POST_FROM_SEARCH_MIN_FONT,
      fontWeight: '700',
    },
    headingProminent: {
      fontSize: 18,
    },
    quote: {
      color: t.text,
      fontSize: POST_FROM_SEARCH_MIN_FONT,
      fontStyle: 'italic',
    },
    note: {
      color: t.textSecondary,
      fontSize: POST_FROM_SEARCH_MIN_FONT,
    },
    button: {
      minHeight: SIZING.COMFORTABLE_TOUCH_TARGET,
      paddingHorizontal: SPACING.BUTTON_PADDING_HORIZONTAL,
      paddingVertical: SPACING.BUTTON_PADDING_VERTICAL,
      borderRadius: 12,
      backgroundColor: t.primary,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 4,
    },
    buttonBusy: {
      opacity: 0.6,
    },
    buttonLabel: {
      color: '#ffffff',
      fontSize: POST_FROM_SEARCH_MIN_FONT,
      fontWeight: '700',
      textAlign: 'center',
    },
  });
}
