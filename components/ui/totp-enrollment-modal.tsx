/**
 * TotpEnrollmentModal
 *
 * Displays the QR code and TOTP secret returned from `supabase.auth.mfa.enroll`
 * so the user can register their authenticator app, then collects the first
 * 6-digit verification code to activate the factor.
 *
 * Supabase returns `data.totp.qr_code` either as a raw `<svg>` string or as a
 * `data:image/svg+xml;...` data URI.  Both forms are handled by extracting the
 * raw SVG and rendering it with `react-native-svg`'s `SvgXml`.  If neither is
 * present we fall back to displaying the manual setup secret only.
 */

import { useAppThemeContext } from 'lib/themes/AppThemeContext';
import type { AppTheme } from 'lib/themes/types';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SvgXml } from 'react-native-svg';
import { ThemedButton } from '../themed/ThemedButton';

interface TotpEnrollmentModalProps {
  visible: boolean;
  /**
   * The `data.totp` payload returned by `supabase.auth.mfa.enroll`. May be
   * null while the enrollment request is in flight.
   */
  totp: { secret: string; uri: string; qr_code?: string } | null;
  isVerifying?: boolean;
  error?: string | null;
  onVerify: (code: string) => void;
  onCancel: () => void;
}

/**
 * Extract a raw SVG XML string from Supabase's `qr_code` field, which may
 * arrive as either a plain `<svg>...</svg>` string or a `data:image/svg+xml`
 * URI (URL- or base64-encoded).  Returns null if no SVG can be recovered.
 */
function extractSvgXml(qrCode?: string): string | null {
  if (!qrCode) return null;
  const trimmed = qrCode.trim();

  // Case 1: already a raw SVG document.
  if (trimmed.startsWith('<svg')) return trimmed;

  // Case 2: data URI.  Examples:
  //   data:image/svg+xml;utf8,<svg ...>...</svg>
  //   data:image/svg+xml,<svg ...>...</svg>
  //   data:image/svg+xml;base64,PHN2Zy...=
  if (trimmed.startsWith('data:image/svg+xml')) {
    const commaIdx = trimmed.indexOf(',');
    if (commaIdx < 0) return null;
    const meta = trimmed.slice(5, commaIdx); // strip leading "data:"
    const payload = trimmed.slice(commaIdx + 1);
    try {
      if (meta.includes(';base64')) {
        // `atob` is available globally on Hermes (the JS engine used by this
        // app per `app.json` -> `expo-build-properties.useHermesV1: true`).
        // `Buffer` is intentionally NOT used here because it is not part of
        // the React Native global scope without a polyfill.
        const globalAtob = (globalThis as { atob?: (s: string) => string }).atob;
        if (typeof globalAtob === 'function') {
          return globalAtob(payload);
        }
        console.warn('[TotpEnrollmentModal] base64 QR payload but no atob available');
        return null;
      }
      return decodeURIComponent(payload);
    } catch (e) {
      console.warn('[TotpEnrollmentModal] Failed to decode QR data URI:', e);
      return null;
    }
  }

  return null;
}

export function TotpEnrollmentModal({
  visible,
  totp,
  isVerifying = false,
  error,
  onVerify,
  onCancel,
}: TotpEnrollmentModalProps) {
  const { theme } = useAppThemeContext();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const [code, setCode] = useState('');
  const inputRef = useRef<TextInput>(null);
  const focusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (visible) {
      setCode('');
      focusTimeoutRef.current = setTimeout(() => {
        inputRef.current?.focus();
      }, 150);
    }
    return () => {
      if (focusTimeoutRef.current) {
        clearTimeout(focusTimeoutRef.current);
        focusTimeoutRef.current = null;
      }
    };
  }, [visible]);

  const svgXml = useMemo(() => extractSvgXml(totp?.qr_code), [totp?.qr_code]);

  const handleVerify = () => {
    if (code.trim().length === 6 && !isVerifying) {
      onVerify(code.trim());
    }
  };

  // While verification is in flight, ignore the Android hardware back button
  // (and other Modal close requests). Cancelling at that moment would race
  // with `challengeAndVerify` and could unenroll a factor that just got
  // verified server-side, leaving UI/back-end state inconsistent.
  const handleRequestClose = () => {
    if (isVerifying) {
      return;
    }
    onCancel();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleRequestClose}
      accessibilityViewIsModal
    >
      <View style={s.scrim}>
        <View style={s.card}>
          <ScrollView
            contentContainerStyle={s.cardContent}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={s.title}>Set Up Two-Factor Authentication</Text>
            <Text style={s.subtitle}>
              Scan the QR code with Google Authenticator, Authy, or any TOTP app.
              Then enter the 6-digit code shown in the app to finish enrolling.
            </Text>

            {/* QR code — kept on a fixed white plate regardless of theme, since the
                SVG's own modules assume a white background to stay scannable. */}
            <View style={s.qrPlate} accessible accessibilityLabel="Two-factor authentication QR code">
              {svgXml ? (
                <SvgXml xml={svgXml} width={200} height={200} />
              ) : (
                <View style={s.qrUnavailable}>
                  <Text style={s.qrUnavailableTitle}>QR code unavailable.</Text>
                  <Text style={s.qrUnavailableSubtitle}>
                    Use the manual setup key below to add the account by hand.
                  </Text>
                </View>
              )}
            </View>

            {/* Manual setup secret */}
            {totp?.secret ? (
              <View style={s.secretBlock}>
                <Text style={s.secretLabel}>Can&apos;t scan? Enter this key manually:</Text>
                <Text selectable style={s.secretValue} accessibilityLabel="Manual setup key">
                  {totp.secret}
                </Text>
              </View>
            ) : null}

            {/* Verification code input */}
            <Text style={s.codeLabel}>Enter the 6-digit code from your authenticator app:</Text>
            <TextInput
              ref={inputRef}
              value={code}
              onChangeText={text => setCode(text.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              placeholderTextColor={theme.textDisabled}
              keyboardType="number-pad"
              maxLength={6}
              editable={!isVerifying}
              onSubmitEditing={handleVerify}
              style={[s.codeInput, error ? s.codeInputError : null]}
              accessibilityLabel="Enter your 2FA verification code"
              accessibilityHint="6-digit code from your authenticator app"
            />

            {error ? (
              <Text style={s.errorText}>{error}</Text>
            ) : (
              <View style={{ height: 12 }} />
            )}

            <View style={s.actionsRow}>
              <ThemedButton
                variant="secondary"
                label="Cancel"
                onPress={onCancel}
                disabled={isVerifying}
                style={s.actionButton}
                accessibilityLabel="Cancel two-factor setup"
              />
              <ThemedButton
                variant="primary"
                label="Verify & Enable"
                onPress={handleVerify}
                disabled={isVerifying || code.length !== 6}
                loading={isVerifying}
                style={s.actionButton}
                accessibilityLabel="Verify and enable two-factor authentication"
              />
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    scrim: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: 'rgba(0,0,0,0.7)',
      padding: 16,
    },
    card: {
      width: '100%',
      maxWidth: 420,
      maxHeight: '90%',
      backgroundColor: t.surface,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: t.border,
    },
    cardContent: {
      padding: 24,
    },
    title: {
      fontSize: 18,
      fontWeight: '700',
      color: t.text,
      marginBottom: 6,
    },
    subtitle: {
      fontSize: 13,
      color: t.textSecondary,
      lineHeight: 18,
      marginBottom: 16,
    },
    qrPlate: {
      backgroundColor: '#ffffff',
      padding: 12,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 16,
      minHeight: 220,
    },
    qrUnavailable: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 32,
    },
    qrUnavailableTitle: {
      color: '#374151',
      fontSize: 13,
      textAlign: 'center',
      marginBottom: 8,
    },
    qrUnavailableSubtitle: {
      color: '#6b7280',
      fontSize: 12,
      textAlign: 'center',
    },
    secretBlock: {
      marginBottom: 16,
    },
    secretLabel: {
      fontSize: 12,
      color: t.textSecondary,
      marginBottom: 4,
    },
    secretValue: {
      color: t.text,
      fontSize: 14,
      fontFamily: 'Courier',
      backgroundColor: t.surfaceSecondary,
      padding: 10,
      borderRadius: 8,
      letterSpacing: 1,
    },
    codeLabel: {
      fontSize: 13,
      color: t.textSecondary,
      marginBottom: 6,
    },
    codeInput: {
      backgroundColor: t.surfaceSecondary,
      borderRadius: 10,
      paddingHorizontal: 16,
      paddingVertical: 14,
      color: t.text,
      fontSize: 24,
      textAlign: 'center',
      letterSpacing: 8,
      fontVariant: ['tabular-nums'],
      borderWidth: 1,
      borderColor: t.border,
      marginBottom: 8,
    },
    codeInputError: {
      borderColor: t.error,
    },
    errorText: {
      fontSize: 12,
      color: t.error,
      marginBottom: 12,
      textAlign: 'center',
    },
    actionsRow: {
      flexDirection: 'row',
      gap: 12,
    },
    actionButton: {
      flex: 1,
    },
  });
}
