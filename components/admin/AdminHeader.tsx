// components/admin/AdminHeader.tsx - Header component for admin screens
import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface AdminHeaderProps {
  title: string;
  onBack?: () => void;
  actions?: React.ReactNode;
}

export function AdminHeader({ title, onBack, actions }: AdminHeaderProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) }]}>
      <View style={styles.row}>
        {onBack && (
          <TouchableOpacity onPress={onBack} style={styles.backButton}>
            <MaterialIcons name="arrow-back" size={24} color="#fffef5" />
          </TouchableOpacity>
        )}
        <View style={styles.titleContainer}>
          <Text style={styles.title}>{title}</Text>
          <View style={styles.adminBadge}>
            <Text style={styles.adminBadgeText}>ADMIN</Text>
          </View>
        </View>
        {actions && <View style={styles.actions}>{actions}</View>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: '#1a3d2e',
    paddingBottom: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,145,44,0.2)',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  backButton: {
    padding: 8,
  },
  titleContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fffef5',
  },
  adminBadge: {
    backgroundColor: 'rgba(0,145,44,0.2)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(0,145,44,0.4)',
  },
  adminBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#00dc50',
    letterSpacing: 0.5,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
  },
});
