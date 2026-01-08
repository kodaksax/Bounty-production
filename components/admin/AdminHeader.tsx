// components/admin/AdminHeader.tsx - Header component for admin screens
import { MaterialIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useCallback } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAdmin } from '../../lib/admin-context';
import { ROUTES } from '../../lib/routes';

interface AdminHeaderProps {
  title: string;
  onBack?: () => void;
  actions?: React.ReactNode;
  showBack?: boolean; // explicit control if needed
}

export function AdminHeader({ title, onBack, actions, showBack }: AdminHeaderProps) {
  const insets = useSafeAreaInsets();
  const { setAdminTabEnabled } = useAdmin();

  // Removed settings navigation button per request

  const handleExitAdmin = useCallback(() => {
    Alert.alert('Hide Admin Tab', 'Hide the admin tab and return to the main app? You can re-enable it from Settings.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Hide', style: 'default', onPress: async () => {
          await setAdminTabEnabled(false);
          try {
            router.replace(ROUTES.TABS.BOUNTY_APP);
          } catch {}
        }
      }
    ]);
  }, [setAdminTabEnabled]);

  return (
    <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) }]}>
      <View style={styles.row}>
        {(onBack || showBack) && (
          <TouchableOpacity accessibilityRole="button" onPress={onBack} style={styles.backButton}>
            <MaterialIcons name="arrow-back" size={24} color="#fffef5" />
          </TouchableOpacity>
        )}
        <View style={styles.titleContainer}>
          <Text style={styles.title}>{title}</Text>
          <View style={styles.adminBadge}>
            <Text style={styles.adminBadgeText}>ADMIN</Text>
          </View>
        </View>
        <View style={styles.actions}>
          {actions}
          {/* Exit admin */}
            <TouchableOpacity onPress={handleExitAdmin} style={styles.iconButton} accessibilityLabel="Hide admin tab" accessibilityRole="button">
              <MaterialIcons name="admin-panel-settings" size={22} color="#ffddb5" />
            </TouchableOpacity>
        </View>
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
  iconButton: {
    padding: 6,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.06)'
  }
});
