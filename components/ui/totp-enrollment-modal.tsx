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

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SvgXml } from 'react-native-svg';

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
        // atob is available on modern RN/Hermes; decodeURIComponent guards
        // against any URI escaping after base64 decoding.
        // eslint-disable-next-line no-undef
        const decoded = typeof atob === 'function' ? atob(payload) : Buffer.from(payload, 'base64').toString('utf8');
        return decoded;
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

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      accessibilityViewIsModal
    >
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: 'rgba(0,0,0,0.7)',
          padding: 16,
        }}
      >
        <View
          style={{
            width: '100%',
            maxWidth: 420,
            maxHeight: '90%',
            backgroundColor: '#065f46',
            borderRadius: 16,
            borderWidth: 1,
            borderColor: 'rgba(167,243,208,0.2)',
          }}
        >
          <ScrollView
            contentContainerStyle={{ padding: 24 }}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={{ fontSize: 18, fontWeight: '600', color: '#fff', marginBottom: 6 }}>
              Set Up Two-Factor Authentication
            </Text>
            <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.75)', lineHeight: 18, marginBottom: 16 }}>
              Scan the QR code with Google Authenticator, Authy, or any TOTP app.
              Then enter the 6-digit code shown in the app to finish enrolling.
            </Text>

            {/* QR code */}
            <View
              style={{
                backgroundColor: '#fff',
                padding: 12,
                borderRadius: 12,
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 16,
                minHeight: 220,
              }}
              accessible
              accessibilityLabel="Two-factor authentication QR code"
            >
              {svgXml ? (
                <SvgXml xml={svgXml} width={200} height={200} />
              ) : (
                <View style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 32 }}>
                  <Text style={{ color: '#374151', fontSize: 13, textAlign: 'center', marginBottom: 8 }}>
                    QR code unavailable.
                  </Text>
                  <Text style={{ color: '#6b7280', fontSize: 12, textAlign: 'center' }}>
                    Use the manual setup key below to add the account by hand.
                  </Text>
                </View>
              )}
            </View>

            {/* Manual setup secret */}
            {totp?.secret ? (
              <View style={{ marginBottom: 16 }}>
                <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', marginBottom: 4 }}>
                  Can&apos;t scan? Enter this key manually:
                </Text>
                <Text
                  selectable
                  style={{
                    color: '#a7f3d0',
                    fontSize: 14,
                    fontFamily: 'Courier',
                    backgroundColor: 'rgba(0,0,0,0.25)',
                    padding: 10,
                    borderRadius: 8,
                    letterSpacing: 1,
                  }}
                  accessibilityLabel={`Manual setup key ${totp.secret}`}
                >
                  {totp.secret}
                </Text>
              </View>
            ) : null}

            {/* Verification code input */}
            <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.85)', marginBottom: 6 }}>
              Enter the 6-digit code from your authenticator app:
            </Text>
            <TextInput
              ref={inputRef}
              value={code}
              onChangeText={text => setCode(text.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              placeholderTextColor="rgba(255,255,255,0.3)"
              keyboardType="number-pad"
              maxLength={6}
              editable={!isVerifying}
              onSubmitEditing={handleVerify}
              style={{
                backgroundColor: 'rgba(255,255,255,0.1)',
                borderRadius: 10,
                paddingHorizontal: 16,
                paddingVertical: 14,
                color: '#fff',
                fontSize: 24,
                textAlign: 'center',
                letterSpacing: 8,
                fontVariant: ['tabular-nums'],
                borderWidth: error ? 1 : 0,
                borderColor: error ? '#f87171' : undefined,
                marginBottom: 8,
              }}
              accessibilityLabel="Enter your 2FA verification code"
              accessibilityHint="6-digit code from your authenticator app"
            />

            {error ? (
              <Text style={{ fontSize: 12, color: '#f87171', marginBottom: 12, textAlign: 'center' }}>
                {error}
              </Text>
            ) : (
              <View style={{ height: 12 }} />
            )}

            <View style={{ flexDirection: 'row', gap: 12 }}>
              <TouchableOpacity
                onPress={onCancel}
                disabled={isVerifying}
                style={{
                  flex: 1,
                  paddingVertical: 12,
                  borderRadius: 8,
                  backgroundColor: 'rgba(255,255,255,0.1)',
                  alignItems: 'center',
                }}
                accessibilityRole="button"
                accessibilityLabel="Cancel two-factor setup"
              >
                <Text style={{ color: 'rgba(255,255,255,0.85)', fontWeight: '500' }}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleVerify}
                disabled={isVerifying || code.length !== 6}
                style={{
                  flex: 1,
                  paddingVertical: 12,
                  borderRadius: 8,
                  backgroundColor: code.length === 6 && !isVerifying ? '#059669' : 'rgba(5,150,105,0.4)',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                accessibilityRole="button"
                accessibilityLabel="Verify and enable two-factor authentication"
                accessibilityState={{ disabled: isVerifying || code.length !== 6 }}
              >
                {isVerifying ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={{ color: '#fff', fontWeight: '600' }}>Verify &amp; Enable</Text>
                )}
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
