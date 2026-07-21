/**
 * MfaCodeModal
 *
 * Cross-platform modal for entering a 6-digit TOTP verification code.
 * Replaces `Alert.prompt` which is iOS-only and inaccessible.
 */

import { useAppThemeContext } from 'lib/themes/AppThemeContext';
import type { AppTheme } from 'lib/themes/types';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { ThemedButton } from '../themed/ThemedButton';

interface MfaCodeModalProps {
  visible: boolean;
  title?: string;
  subtitle?: string;
  isLoading?: boolean;
  error?: string | null;
  onVerify: (code: string) => void;
  onCancel: () => void;
}

export function MfaCodeModal({
  visible,
  title = 'Enter Verification Code',
  subtitle = 'Enter the 6-digit code from your authenticator app.',
  isLoading = false,
  error,
  onVerify,
  onCancel,
}: MfaCodeModalProps) {
  const { theme } = useAppThemeContext();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const [code, setCode] = useState('');
  const inputRef = useRef<TextInput>(null);
  const focusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset code when the modal becomes visible
  useEffect(() => {
    if (visible) {
      setCode('');
      // Small delay so the modal is fully rendered before focusing
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

  const handleVerify = () => {
    if (code.trim().length === 6) {
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
      <View style={s.scrim}>
        <View style={s.card}>
          <Text style={s.title}>{title}</Text>
          <Text style={s.subtitle}>{subtitle}</Text>

          <TextInput
            ref={inputRef}
            value={code}
            onChangeText={text => setCode(text.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            placeholderTextColor={theme.textDisabled}
            keyboardType="number-pad"
            maxLength={6}
            editable={!isLoading}
            onSubmitEditing={handleVerify}
            style={[s.codeInput, error ? s.codeInputError : null]}
            accessibilityLabel="Enter your 2FA verification code"
            accessibilityHint="6-digit code from your authenticator app"
          />

          {error ? (
            <Text style={s.errorText}>{error}</Text>
          ) : (
            <View style={{ height: 16 }} />
          )}

          <View style={s.actionsRow}>
            <ThemedButton
              variant="secondary"
              label="Cancel"
              onPress={onCancel}
              disabled={isLoading}
              style={s.actionButton}
              accessibilityLabel="Cancel"
            />
            <ThemedButton
              variant="primary"
              label="Verify"
              onPress={handleVerify}
              disabled={isLoading || code.length !== 6}
              loading={isLoading}
              style={s.actionButton}
              accessibilityLabel="Verify code"
            />
          </View>
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
      backgroundColor: 'rgba(0,0,0,0.6)',
    },
    card: {
      width: '85%',
      backgroundColor: t.surface,
      borderRadius: 16,
      padding: 24,
      borderWidth: 1,
      borderColor: t.border,
    },
    title: {
      fontSize: 18,
      fontWeight: '700',
      color: t.text,
      marginBottom: 8,
    },
    subtitle: {
      fontSize: 13,
      color: t.textSecondary,
      marginBottom: 20,
      lineHeight: 18,
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
      marginBottom: 16,
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
