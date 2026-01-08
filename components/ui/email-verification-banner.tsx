/**
 * Email Verification Banner
 * Displays a banner prompting users to verify their email
 */

import { MaterialIcons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { resendVerification } from '../../lib/services/auth-service';

interface EmailVerificationBannerProps {
  email?: string;
  onDismiss?: () => void;
}

export function EmailVerificationBanner({ email, onDismiss }: EmailVerificationBannerProps) {
  const [isResending, setIsResending] = useState(false);
  const [resendSuccess, setResendSuccess] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);

  const handleResend = async () => {
    if (!email || isResending) return;

    setIsResending(true);
    const result = await resendVerification(email);
    setIsResending(false);

    if (result.success) {
      setResendSuccess(true);
      setTimeout(() => setResendSuccess(false), 3000);
    }
  };

  const handleDismiss = () => {
    setIsDismissed(true);
    onDismiss?.();
  };

  if (isDismissed) return null;

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <View style={styles.iconContainer}>
          <MaterialIcons name="mark-email-unread" size={24} color="#f59e0b" />
        </View>
        <View style={styles.textContainer}>
          <Text style={styles.title}>Verify your email to unlock full access</Text>
          <Text style={styles.subtitle}>
            Check your inbox for the verification link. You cannot post bounties or withdraw funds until verified.
          </Text>
          {resendSuccess ? (
            <Text style={styles.successText}>✓ Verification email sent!</Text>
          ) : (
            <TouchableOpacity accessibilityRole="button" 
              onPress={handleResend} 
              disabled={isResending}
              style={styles.resendButton}
            >
              {isResending ? (
                <ActivityIndicator size="small" color="#f59e0b" />
              ) : (
                <Text style={styles.resendText}>Resend verification email</Text>
              )}
            </TouchableOpacity>
          )}
        </View>
      </View>
      <TouchableOpacity 
        onPress={handleDismiss} 
        style={styles.dismissButton}
        accessibilityLabel="Dismiss banner"
      >
        <MaterialIcons name="close" size={20} color="rgba(255,255,255,0.6)" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: 'rgba(245,158,11,0.15)',
    borderLeftWidth: 4,
    borderLeftColor: '#f59e0b',
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginHorizontal: 16,
    marginVertical: 8,
    borderRadius: 8,
    alignItems: 'flex-start',
  },
  content: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  iconContainer: {
    marginRight: 12,
    marginTop: 2,
  },
  textContainer: {
    flex: 1,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.8)',
    lineHeight: 18,
    marginBottom: 8,
  },
  resendButton: {
    alignSelf: 'flex-start',
    paddingVertical: 4,
  },
  resendText: {
    fontSize: 13,
    color: '#f59e0b',
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  successText: {
    fontSize: 13,
    color: '#10b981',
    fontWeight: '600',
  },
  dismissButton: {
    padding: 4,
    marginLeft: 8,
  },
});
