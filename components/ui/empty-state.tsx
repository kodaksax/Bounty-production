import React from 'react';
import { View, Text, StyleSheet, ViewStyle, Animated, Easing } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { SPACING, SIZING, TYPOGRAPHY, A11Y } from '../../lib/constants/accessibility';
import { Button } from './button';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';
import { useAccessibleAnimation, useFadeSlideAnimation } from '../../hooks/use-accessible-animation';

/** Converts a theme hex color to an rgba() string at the given alpha. */
function withAlpha(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const int = parseInt(full, 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export interface EmptyStateFeature {
  icon: keyof typeof MaterialIcons.glyphMap;
  label: string;
}

interface EmptyStateProps {
  icon?: keyof typeof MaterialIcons.glyphMap;
  title: string;
  description: string;
  /**
   * Optional short list of "what you'll find here" bullets — turns a blank
   * screen into a teaching moment (e.g. the statuses or capabilities a tab covers).
   */
  features?: EmptyStateFeature[];
  /**
   * Optional small reassurance/help line rendered below the CTA(s), e.g.
   * "New requests will appear here automatically."
   */
  footnote?: string;
  actionLabel?: string;
  onAction?: () => void;
  /**
   * Secondary action for additional options
   */
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  /**
   * Visual variant for different contexts
   */
  variant?: 'default' | 'compact' | 'card';
  /**
   * Size of the empty state
   */
  size?: 'sm' | 'md' | 'lg';
  /**
   * Color accent used for the icon badge and feature chips.
   * 'success' suits reassuring "you're all caught up" states.
   */
  tone?: 'brand' | 'success' | 'info';
  style?: ViewStyle;
}

/**
 * EmptyState — themed, animated placeholder for empty lists.
 * Doubles as a lightweight onboarding moment: title + description explain the
 * tab's purpose, an optional feature list previews what will appear, and a
 * primary CTA moves the user toward their first bit of content.
 */
export function EmptyState({
  icon = 'search-off',
  title,
  description,
  features,
  footnote,
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
  variant = 'default',
  size = 'md',
  tone = 'brand',
  style
}: EmptyStateProps) {
  const { theme } = useAppThemeContext();
  const styles = React.useMemo(() => makeStyles(theme), [theme]);

  const { prefersReducedMotion, createSpring, createTiming } = useAccessibleAnimation();
  const { style: contentAnimStyle, animateIn: animateContentIn } = useFadeSlideAnimation('up', 14);

  const iconScale = React.useRef(new Animated.Value(prefersReducedMotion ? 1 : 0)).current;

  React.useEffect(() => {
    animateContentIn(A11Y.ANIMATION_NORMAL);

    if (prefersReducedMotion) {
      iconScale.setValue(1);
      return;
    }

    let floatAnimation: Animated.CompositeAnimation | undefined;
    let floatTimeout: ReturnType<typeof setTimeout> | undefined;

    Animated.sequence([
      createSpring(iconScale, 1.1, { tension: 40, friction: 3 }),
      createSpring(iconScale, 1, { tension: 50, friction: 7 }),
    ]).start();

    floatTimeout = setTimeout(() => {
      floatAnimation = Animated.loop(
        Animated.sequence([
          createTiming(iconScale, 1.05, 2000, Easing.inOut(Easing.ease)),
          createTiming(iconScale, 1, 2000, Easing.inOut(Easing.ease)),
        ])
      );
      floatAnimation.start();
    }, 550);

    return () => {
      if (floatTimeout) clearTimeout(floatTimeout);
      floatAnimation?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefersReducedMotion]);

  const toneColor = tone === 'success' ? theme.success : tone === 'info' ? theme.info : theme.primary;

  // Size-based configuration
  const sizeConfig = {
    sm: {
      iconSize: 36,
      iconContainerSize: SIZING.AVATAR_LARGE,
      titleSize: TYPOGRAPHY.SIZE_BODY,
      descSize: TYPOGRAPHY.SIZE_SMALL,
      padding: SPACING.SCREEN_HORIZONTAL,
    },
    md: {
      iconSize: 48,
      iconContainerSize: SIZING.AVATAR_XLARGE,
      titleSize: TYPOGRAPHY.SIZE_LARGE,
      descSize: TYPOGRAPHY.SIZE_DEFAULT,
      padding: 32,
    },
    lg: {
      iconSize: 56,
      iconContainerSize: SIZING.AVATAR_XLARGE + 16,
      titleSize: TYPOGRAPHY.SIZE_XLARGE,
      descSize: TYPOGRAPHY.SIZE_BODY,
      padding: 40,
    },
  };

  const config = sizeConfig[size];

  const a11ySummary = [
    title,
    description,
    features && features.length > 0 ? `Includes: ${features.map((f) => f.label).join(', ')}.` : null,
    footnote,
  ]
    .filter(Boolean)
    .join('. ');

  return (
    <View
      style={[
        styles.container,
        variant === 'card' && styles.cardContainer,
        variant === 'compact' && styles.compactContainer,
        { paddingHorizontal: config.padding },
        style
      ]}
      accessible={true}
      accessibilityRole="text"
      accessibilityLabel={a11ySummary}
    >
      <Animated.View
        style={[
          styles.iconContainer,
          {
            width: config.iconContainerSize,
            height: config.iconContainerSize,
            borderRadius: config.iconContainerSize / 2,
            backgroundColor: withAlpha(toneColor, theme.isDark ? 0.14 : 0.1),
            borderColor: withAlpha(toneColor, theme.isDark ? 0.35 : 0.25),
            shadowColor: toneColor,
            shadowOpacity: theme.isDark ? 0.4 : 0.18,
            transform: [{ scale: iconScale }],
          },
        ]}
      >
        <MaterialIcons
          name={icon}
          size={config.iconSize}
          color={toneColor}
          accessibilityElementsHidden={true}
        />
      </Animated.View>

      <Animated.View style={contentAnimStyle}>
        <Text
          style={[styles.title, { fontSize: config.titleSize }]}
          accessibilityRole="header"
        >
          {title}
        </Text>

        <Text style={[styles.description, { fontSize: config.descSize }]}>
          {description}
        </Text>

        {features && features.length > 0 && (
          <View style={styles.featurePanel}>
            {features.map((feature, index) => (
              <View
                key={feature.label}
                style={[styles.featureRow, index === features.length - 1 && { marginBottom: 0 }]}
              >
                <View style={[styles.featureIconWrap, { backgroundColor: withAlpha(toneColor, theme.isDark ? 0.16 : 0.12) }]}>
                  <MaterialIcons name={feature.icon} size={15} color={toneColor} />
                </View>
                <Text style={styles.featureLabel}>{feature.label}</Text>
              </View>
            ))}
          </View>
        )}

        {(actionLabel && onAction) && (
          <Button
            onPress={onAction}
            style={styles.actionButton}
            accessibilityLabel={actionLabel}
            accessibilityHint="Primary action for this empty state"
          >
            {actionLabel}
          </Button>
        )}

        {(secondaryActionLabel && onSecondaryAction) && (
          <Button
            variant="ghost"
            onPress={onSecondaryAction}
            style={styles.secondaryButton}
            accessibilityLabel={secondaryActionLabel}
            accessibilityHint="Secondary action for this empty state"
          >
            {secondaryActionLabel}
          </Button>
        )}

        {footnote && (
          <Text style={styles.footnote}>{footnote}</Text>
        )}
      </Animated.View>
    </View>
  );
}

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
    container: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 32,
      paddingVertical: SIZING.AVATAR_MEDIUM,
    },
    cardContainer: {
      backgroundColor: withAlpha(theme.primary, theme.isDark ? 0.08 : 0.05),
      borderRadius: 16,
      borderWidth: 1,
      borderColor: theme.border,
      marginHorizontal: SPACING.SCREEN_HORIZONTAL,
      marginVertical: SPACING.ELEMENT_GAP,
    },
    compactContainer: {
      paddingVertical: SPACING.SECTION_GAP,
      paddingHorizontal: SPACING.SCREEN_HORIZONTAL,
    },
    iconContainer: {
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: SPACING.SECTION_GAP,
      borderWidth: 2,
      shadowOffset: { width: 0, height: 0 },
      shadowRadius: 16,
      elevation: 6,
    },
    title: {
      fontSize: TYPOGRAPHY.SIZE_LARGE,
      fontWeight: '700',
      color: theme.text,
      textAlign: 'center',
      marginBottom: SPACING.ELEMENT_GAP,
      lineHeight: Math.round(TYPOGRAPHY.SIZE_LARGE * TYPOGRAPHY.LINE_HEIGHT_NORMAL),
    },
    description: {
      fontSize: TYPOGRAPHY.SIZE_DEFAULT,
      color: theme.textSecondary,
      textAlign: 'center',
      lineHeight: Math.round(TYPOGRAPHY.SIZE_DEFAULT * TYPOGRAPHY.LINE_HEIGHT_RELAXED),
      marginBottom: SPACING.SECTION_GAP,
    },
    featurePanel: {
      alignSelf: 'stretch',
      backgroundColor: theme.surfaceSecondary,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: theme.border,
      paddingVertical: 12,
      paddingHorizontal: 14,
      marginBottom: SPACING.SECTION_GAP,
    },
    featureRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 10,
    },
    featureIconWrap: {
      width: 26,
      height: 26,
      borderRadius: 13,
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: 10,
      flexShrink: 0,
    },
    featureLabel: {
      flex: 1,
      color: theme.text,
      fontSize: TYPOGRAPHY.SIZE_SMALL,
      fontWeight: '600',
    },
    actionButton: {
      marginTop: SPACING.COMPACT_GAP,
      minWidth: 200,
    },
    secondaryButton: {
      marginTop: SPACING.COMPACT_GAP,
    },
    footnote: {
      marginTop: SPACING.SECTION_GAP,
      fontSize: TYPOGRAPHY.SIZE_XSMALL,
      color: theme.textDisabled,
      textAlign: 'center',
      lineHeight: Math.round(TYPOGRAPHY.SIZE_XSMALL * TYPOGRAPHY.LINE_HEIGHT_NORMAL),
    },
  });
}

/**
 * BountyEmptyState - Specialized empty state for bounty lists
 */
interface BountyEmptyStateProps {
  filter?: 'all' | 'open' | 'in_progress' | 'completed';
  onClearFilter?: () => void;
}

export function BountyEmptyState({ filter = 'all', onClearFilter }: BountyEmptyStateProps) {
  const getEmptyStateContent = () => {
    switch (filter) {
      case 'open':
        return {
          icon: 'work-outline' as keyof typeof MaterialIcons.glyphMap,
          title: 'No Open Bounties Yet',
          description: 'Check back soon for new opportunities, or post your first bounty to get started!',
        };
      case 'in_progress':
        return {
          icon: 'hourglass-empty' as keyof typeof MaterialIcons.glyphMap,
          title: 'No Active Work Yet',
          description: 'Ready to get started? Browse available bounties and accept one to begin earning!',
        };
      case 'completed':
        return {
          icon: 'check-circle-outline' as keyof typeof MaterialIcons.glyphMap,
          title: 'No Completed Bounties Yet',
          description: 'Complete your first bounty to see it here and build your reputation!',
        };
      default:
        return {
          icon: 'search-off' as keyof typeof MaterialIcons.glyphMap,
          title: 'No Bounties Yet',
          description: 'Create your first bounty to get started, or browse available opportunities to earn!',
        };
    }
  };

  const content = getEmptyStateContent();

  return (
    <EmptyState
      icon={content.icon}
      title={content.title}
      description={content.description}
      actionLabel={filter !== 'all' ? 'Clear Filter' : undefined}
      onAction={filter !== 'all' ? onClearFilter : undefined}
    />
  );
}
