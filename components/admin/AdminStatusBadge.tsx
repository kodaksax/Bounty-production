// components/admin/AdminStatusBadge.tsx - Status badge component for admin screens
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

interface AdminStatusBadgeProps {
  status: string;
  type?: 'bounty' | 'user' | 'transaction';
}

export function AdminStatusBadge({ status, type = 'bounty' }: AdminStatusBadgeProps) {
  const colors = getStatusColors(status, type);

  return (
    <View style={[styles.badge, { backgroundColor: colors.bg, borderColor: colors.border }]}>
      <Text style={[styles.text, { color: colors.text }]}>{status.toUpperCase()}</Text>
    </View>
  );
}

function getStatusColors(status: string, type: string) {
  // Bounty status colors
  if (type === 'bounty') {
    switch (status) {
      case 'open':
        return { bg: 'rgba(0,145,44,0.15)', border: 'rgba(0,145,44,0.4)', text: '#00dc50' };
      case 'in_progress':
        return { bg: 'rgba(255,193,7,0.15)', border: 'rgba(255,193,7,0.4)', text: '#ffc107' };
      case 'completed':
        return { bg: 'rgba(76,175,80,0.15)', border: 'rgba(76,175,80,0.4)', text: '#4caf50' };
      case 'archived':
        return { bg: 'rgba(158,158,158,0.15)', border: 'rgba(158,158,158,0.4)', text: '#9e9e9e' };
      default:
        return { bg: 'rgba(255,255,255,0.1)', border: 'rgba(255,255,255,0.2)', text: '#fffef5' };
    }
  }

  // User status colors
  if (type === 'user') {
    switch (status) {
      case 'active':
        return { bg: 'rgba(76,175,80,0.15)', border: 'rgba(76,175,80,0.4)', text: '#4caf50' };
      case 'suspended':
        return { bg: 'rgba(255,152,0,0.15)', border: 'rgba(255,152,0,0.4)', text: '#ff9800' };
      case 'banned':
        return { bg: 'rgba(244,67,54,0.15)', border: 'rgba(244,67,54,0.4)', text: '#f44336' };
      default:
        return { bg: 'rgba(255,255,255,0.1)', border: 'rgba(255,255,255,0.2)', text: '#fffef5' };
    }
  }

  // Transaction status colors
  if (type === 'transaction') {
    switch (status) {
      case 'completed':
        return { bg: 'rgba(76,175,80,0.15)', border: 'rgba(76,175,80,0.4)', text: '#4caf50' };
      case 'pending':
        return { bg: 'rgba(255,193,7,0.15)', border: 'rgba(255,193,7,0.4)', text: '#ffc107' };
      case 'failed':
        return { bg: 'rgba(244,67,54,0.15)', border: 'rgba(244,67,54,0.4)', text: '#f44336' };
      default:
        return { bg: 'rgba(255,255,255,0.1)', border: 'rgba(255,255,255,0.2)', text: '#fffef5' };
    }
  }

  return { bg: 'rgba(255,255,255,0.1)', border: 'rgba(255,255,255,0.2)', text: '#fffef5' };
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  text: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
});
