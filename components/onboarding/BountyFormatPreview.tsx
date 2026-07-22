/**
 * Miniature live preview of the bounty feed in a given BountyFormat
 * ('card' | 'compact' | 'grid'). Used by the onboarding style step and can
 * be reused anywhere else a preview of the format is useful. Renders
 * lightweight structural placeholders (not real bounty data) sized to match
 * each format's real layout shape in components/bounty-feed.tsx.
 */
import { useEffect, useRef, useMemo } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useAccessibleAnimation, useFadeAnimation } from '../../hooks/use-accessible-animation';
import type { AppTheme } from '../../lib/themes/types';
import type { BountyFormat } from '../../lib/bounty-format-context';

const SAMPLE_BOUNTIES = [
  { title: 'Yard Cleanup', price: '$45', meta: '0.8 mi · Today' },
  { title: 'Move a Couch', price: '$30', meta: '1.2 mi · Tomorrow' },
  { title: 'Dog Walking', price: '$15', meta: '0.4 mi · Flexible' },
  { title: 'Furniture Build', price: '$60', meta: '2.1 mi · This week' },
];

interface BountyFormatPreviewProps {
  format: BountyFormat;
  theme: AppTheme;
}

export function BountyFormatPreview({ format, theme }: BountyFormatPreviewProps) {
  const { prefersReducedMotion } = useAccessibleAnimation();
  const { fadeValue, fadeIn } = useFadeAnimation(1);
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    if (prefersReducedMotion) {
      fadeValue.setValue(1);
      return;
    }
    fadeValue.setValue(0);
    fadeIn(220);
    // fadeValue/fadeIn are stable across renders; only re-run on format change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [format]);

  const styles = useMemo(() => makeStyles(theme), [theme]);

  return (
    <View
      style={styles.frame}
      accessible
      accessibilityLabel={`Preview of the ${format} bounty layout`}
    >
      <Animated.View style={{ opacity: fadeValue, flex: 1 }}>
        {format === 'card' && (
          <View style={styles.cardWrap}>
            <View style={styles.cardImage} />
            <View style={styles.cardBody}>
              <Text style={styles.cardTitle} numberOfLines={1}>{SAMPLE_BOUNTIES[0].title}</Text>
              <Text style={styles.cardMeta} numberOfLines={1}>{SAMPLE_BOUNTIES[0].meta}</Text>
              <Text style={styles.cardPrice}>{SAMPLE_BOUNTIES[0].price}</Text>
            </View>
          </View>
        )}

        {format === 'compact' && (
          <View style={styles.compactWrap}>
            {SAMPLE_BOUNTIES.map((b) => (
              <View key={b.title} style={styles.compactRow}>
                <View style={styles.compactThumb} />
                <View style={styles.compactTextCol}>
                  <Text style={styles.compactTitle} numberOfLines={1}>{b.title}</Text>
                  <Text style={styles.compactMeta} numberOfLines={1}>{b.meta}</Text>
                </View>
                <Text style={styles.compactPrice}>{b.price}</Text>
              </View>
            ))}
          </View>
        )}

        {format === 'grid' && (
          <View style={styles.gridWrap}>
            {SAMPLE_BOUNTIES.map((b) => (
              <View key={b.title} style={styles.gridCell}>
                <View style={styles.gridImage} />
                <Text style={styles.gridTitle} numberOfLines={1}>{b.title}</Text>
                <Text style={styles.gridPrice}>{b.price}</Text>
              </View>
            ))}
          </View>
        )}
      </Animated.View>
    </View>
  );
}

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
    frame: {
      height: 220,
      borderRadius: 16,
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
      padding: 12,
      overflow: 'hidden',
    },
    // Card format
    cardWrap: {
      flex: 1,
      borderRadius: 12,
      backgroundColor: theme.background,
      borderWidth: 1,
      borderColor: theme.border,
      overflow: 'hidden',
    },
    cardImage: {
      flex: 1,
      backgroundColor: theme.overlay,
    },
    cardBody: {
      padding: 12,
      gap: 4,
    },
    cardTitle: {
      fontSize: 15,
      fontWeight: '600',
      color: theme.text,
    },
    cardMeta: {
      fontSize: 12,
      color: theme.textSecondary,
    },
    cardPrice: {
      fontSize: 14,
      fontWeight: '700',
      color: theme.primary,
    },
    // Compact format
    compactWrap: {
      flex: 1,
      gap: 8,
    },
    compactRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.background,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.border,
      padding: 8,
      gap: 8,
    },
    compactThumb: {
      width: 36,
      height: 36,
      borderRadius: 8,
      backgroundColor: theme.overlay,
    },
    compactTextCol: {
      flex: 1,
      gap: 2,
    },
    compactTitle: {
      fontSize: 13,
      fontWeight: '600',
      color: theme.text,
    },
    compactMeta: {
      fontSize: 11,
      color: theme.textSecondary,
    },
    compactPrice: {
      fontSize: 13,
      fontWeight: '700',
      color: theme.primary,
    },
    // Grid format
    gridWrap: {
      flex: 1,
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    gridCell: {
      width: '47%',
      backgroundColor: theme.background,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.border,
      overflow: 'hidden',
      paddingBottom: 6,
    },
    gridImage: {
      height: 56,
      backgroundColor: theme.overlay,
      marginBottom: 4,
    },
    gridTitle: {
      fontSize: 11,
      fontWeight: '600',
      color: theme.text,
      paddingHorizontal: 6,
    },
    gridPrice: {
      fontSize: 11,
      fontWeight: '700',
      color: theme.primary,
      paddingHorizontal: 6,
    },
  });
}
