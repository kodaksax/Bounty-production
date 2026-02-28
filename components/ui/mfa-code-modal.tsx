/**
 * MfaCodeModal
 *
 * Cross-platform modal for entering a 6-digit TOTP verification code.
 * Replaces `Alert.prompt` which is iOS-only and inaccessible.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { colors } from '../../lib/theme';
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
      <View
        style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.6)' }}
      >
        <View
          style={{
            width: '85%',
            backgroundColor: '#065f46',
            borderRadius: 16,
            padding: 24,
            borderWidth: 1,
            borderColor: 'rgba(167,243,208,0.2)',
          }}
        >
          <Text style={{ fontSize: 18, fontWeight: '600', color: '#fff', marginBottom: 8 }}>
            {title}
          </Text>
          <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', marginBottom: 20, lineHeight: 18 }}>
            {subtitle}
          </Text>

          <TextInput
            ref={inputRef}
            value={code}
            onChangeText={text => setCode(text.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            placeholderTextColor="rgba(255,255,255,0.3)"
            keyboardType="number-pad"
            maxLength={6}
            editable={!isLoading}
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
            <Text style={{ fontSize: 12, color: '#f87171', marginBottom: 16, textAlign: 'center' }}>
              {error}
            </Text>
          ) : (
            <View style={{ height: 16 }} />
          )}

          <View style={{ flexDirection: 'row', gap: 12 }}>
            <TouchableOpacity
              onPress={onCancel}
              disabled={isLoading}
              style={{
                flex: 1,
                paddingVertical: 12,
                borderRadius: 8,
                backgroundColor: 'rgba(255,255,255,0.1)',
                alignItems: 'center',
              }}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
            >
              <Text style={{ color: 'rgba(255,255,255,0.8)', fontWeight: '500' }}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleVerify}
              disabled={isLoading || code.length !== 6}
              style={{
                flex: 1,
                paddingVertical: 12,
                borderRadius: 8,
                backgroundColor: code.length === 6 && !isLoading ? colors.primary[600] : 'rgba(5,150,105,0.4)',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              accessibilityRole="button"
              accessibilityLabel="Verify code"
              accessibilityState={{ disabled: isLoading || code.length !== 6 }}
            >
              {isLoading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={{ color: '#fff', fontWeight: '600' }}>Verify</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}
