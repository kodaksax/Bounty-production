// components/admin/AdminStatRow.tsx - Stat row component for admin metrics
//
// Compatibility wrapper over AdminRow (see AdminUI.tsx). Kept so existing
// screens keep working; AdminRow adds link/mono support on top.
import React from 'react';
import { AdminRow } from './AdminUI';

interface AdminStatRowProps {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
  /** Render as a tappable link to a related record. */
  onPress?: () => void;
  /** Use the compact treatment for identifiers (UUIDs, Stripe ids). */
  mono?: boolean;
}

export function AdminStatRow({ label, value, onPress, mono }: AdminStatRowProps) {
  return <AdminRow label={label} value={value} onPress={onPress} mono={mono} />;
}
