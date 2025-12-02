// components/admin/AdminCard.tsx - Reusable card component for admin screens
import React from 'react';
import { StyleSheet, View } from 'react-native';

interface AdminCardProps {
  children: React.ReactNode;
  style?: any;
}

export function AdminCard({ children, style }: AdminCardProps) {
  return <View style={[styles.card, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#007523',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,142,42,0.2)',
  },
});
