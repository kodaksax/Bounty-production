// components/admin/AdminStatRow.tsx - Stat row component for admin metrics
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

interface AdminStatRowProps {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
}

export function AdminStatRow({ label, value, icon }: AdminStatRowProps) {
  return (
    <View style={styles.row}>
      <View style={styles.labelContainer}>
        {icon}
        <Text style={styles.label}>{label}</Text>
      </View>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  labelContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  label: {
    fontSize: 14,
    color: 'rgba(255,254,245,0.8)',
  },
  value: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fffef5',
  },
});
