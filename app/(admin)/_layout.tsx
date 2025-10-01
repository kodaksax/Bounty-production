// app/(admin)/_layout.tsx - Layout for admin route group with gating
import { Redirect, Stack } from 'expo-router';
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useAdmin } from '../../lib/admin-context';

export default function AdminLayout() {
  const { isAdmin, isLoading } = useAdmin();

  // Show loading while checking admin status
  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#00dc50" />
        <Text style={styles.loadingText}>Checking permissions...</Text>
      </View>
    );
  }

  // Redirect if not admin
  if (!isAdmin) {
    return <Redirect href="/tabs/bounty-app" />;
  }

  // Render admin screens if authorized
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: '#1a3d2e' },
      }}
    />
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: '#1a3d2e',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  loadingText: {
    color: 'rgba(255,254,245,0.8)',
    fontSize: 14,
  },
});
