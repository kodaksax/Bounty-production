// components/admin/AdminCard.tsx - Reusable card component for admin screens
//
// Thin compatibility wrapper over AdminPanel so the ~15 screens already
// importing AdminCard pick up the canonical theme tokens without each needing
// to be rewritten in the same commit. Prefer AdminPanel in new code.
import React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { AdminPanel } from './AdminUI';

interface AdminCardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
}

export function AdminCard({ children, style, onPress }: AdminCardProps) {
  return (
    <AdminPanel style={style} onPress={onPress}>
      {children}
    </AdminPanel>
  );
}
