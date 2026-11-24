/**
 * PosterButton — every button kind in the Focus-first handoff (PosterBlock
 * `btn`): primary, quiet, secondary, neutral, text, muted, danger, disabled
 * and loading. Heights follow the handoff (primary 56, secondary 52, text 48)
 * and never drop below the 44pt touch minimum.
 *
 * `disabled` and `loading` exist both as kinds (how the handoff draws them)
 * and as props on any kind, so a screen can keep one kind and switch state.
 * Either way the button reports its state to assistive technology and ignores
 * taps.
 */
import { MaterialIcons } from '@expo/vector-icons';
import * as React from 'react';
import { useMemo } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import type { IconName } from '../../lib/my-jobs/types';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import { FOCUS, type PosterPalette } from '../../lib/themes/poster-palette';

export type PosterButtonKind =
  | 'primary'
  | 'quiet'
  | 'secondary'
  | 'neutral'
  | 'text'
  | 'muted'
  | 'danger'
  | 'disabled'
  | 'loading';

export interface PosterButtonLook {
  backgroundColor: string;
  color: string;
  borderColor: string;
  minHeight: number;
  fontSize: number;
  underline: boolean;
  /** Opacity for the drawn-disabled and drawn-loading kinds. */
  opacity: number;
}

/** The handoff's measurements and colour roles for one kind. Pure, for tests. */
export function getPosterButtonLook(kind: PosterButtonKind, p: PosterPalette): PosterButtonLook {
  const transparent = 'transparent';
  switch (kind) {
    case 'quiet':
      return { backgroundColor: p.card, color: p.gt, borderColor: p.gt, minHeight: FOCUS.buttonPrimary, fontSize: 18, underline: false, opacity: 1 };
    case 'secondary':
      return { backgroundColor: p.card, color: p.gt, borderColor: p.outline, minHeight: FOCUS.buttonSecondary, fontSize: 17, underline: false, opacity: 1 };
    case 'neutral':
      return { backgroundColor: p.card, color: p.ink, borderColor: p.outline, minHeight: FOCUS.buttonSecondary, fontSize: 17, underline: false, opacity: 1 };
    case 'text':
      return { backgroundColor: transparent, color: p.gt, borderColor: transparent, minHeight: FOCUS.buttonText, fontSize: 17, underline: false, opacity: 1 };
    case 'muted':
      return { backgroundColor: transparent, color: p.ink2, borderColor: transparent, minHeight: FOCUS.buttonText, fontSize: 16, underline: true, opacity: 1 };
    case 'danger':
      return { backgroundColor: p.e, color: p.onFill, borderColor: p.e, minHeight: FOCUS.buttonPrimary, fontSize: 19, underline: false, opacity: 1 };
    case 'disabled':
      return { backgroundColor: p.g, color: p.onFill, borderColor: p.g, minHeight: FOCUS.buttonPrimary, fontSize: 19, underline: false, opacity: 0.45 };
    case 'loading':
      return { backgroundColor: p.g, color: p.onFill, borderColor: p.g, minHeight: FOCUS.buttonPrimary, fontSize: 19, underline: false, opacity: 0.8 };
    case 'primary':
    default:
      return { backgroundColor: p.g, color: p.onFill, borderColor: p.g, minHeight: FOCUS.buttonPrimary, fontSize: 19, underline: false, opacity: 1 };
  }
}

export interface PosterButtonProps {
  label: string;
  onPress?: () => void;
  kind?: PosterButtonKind;
  icon?: IconName;
  /** Icon after the label (e.g. "Next person ›"). */
  trailingIcon?: IconName;
  disabled?: boolean;
  /** Shows a spinner, blocks taps and reports busy. */
  loading?: boolean;
  /** Spoken while loading, e.g. "Sending payment". Defaults to the label. */
  loadingLabel?: string;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export function PosterButton({
  label,
  onPress,
  kind = 'primary',
  icon,
  trailingIcon,
  disabled = false,
  loading = false,
  loadingLabel,
  accessibilityLabel,
  accessibilityHint,
  testID,
  style,
}: PosterButtonProps) {
  const { theme } = useAppThemeContext();
  const p = theme.poster;
  const isLoading = loading || kind === 'loading';
  const isDisabled = disabled || kind === 'disabled' || isLoading;
  const look = useMemo(() => getPosterButtonLook(kind, p), [kind, p]);
  // A real kind made disabled by prop dims like the handoff's disabled kind.
  const opacity = disabled && kind !== 'disabled' && !isLoading ? 0.45 : look.opacity;

  return (
    <TouchableOpacity
      onPress={isDisabled ? undefined : onPress}
      disabled={isDisabled}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={isLoading ? loadingLabel ?? accessibilityLabel ?? label : accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: isDisabled, busy: isLoading }}
      testID={testID}
      style={[
        styles.base,
        {
          backgroundColor: look.backgroundColor,
          borderColor: look.borderColor,
          minHeight: look.minHeight,
          opacity,
        },
        style,
      ]}
    >
      {isLoading ? <ActivityIndicator size="small" color={look.color} testID={testID ? `${testID}-spinner` : undefined} /> : null}
      {!isLoading && icon ? <MaterialIcons name={icon} size={22} color={look.color} /> : null}
      <Text
        style={[
          styles.label,
          { color: look.color, fontSize: look.fontSize },
          look.underline && styles.underline,
        ]}
      >
        {label}
      </Text>
      {trailingIcon ? (
        <View>
          <MaterialIcons name={trailingIcon} size={22} color={look.color} />
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1.5,
    borderRadius: FOCUS.buttonRadius,
    paddingHorizontal: 14,
  },
  label: { fontWeight: '700', textAlign: 'center', flexShrink: 1 },
  underline: { textDecorationLine: 'underline' },
});
