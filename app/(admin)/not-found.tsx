// app/(admin)/not-found.tsx - Admin 404/Not Found Screen
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ROUTES } from '../../lib/routes';

export default function AdminNotFoundScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const handleGoToDashboard = () => {
    router.replace(ROUTES.ADMIN.INDEX as any);
  };

  const handleGoBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      handleGoToDashboard();
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.content}>
        <View style={styles.iconContainer}>
          <MaterialIcons name="error-outline" size={80} color="rgba(255,254,245,0.3)" />
        </View>
        
        <Text style={styles.errorCode}>404</Text>
        <Text style={styles.title}>Page Not Found</Text>
        <Text style={styles.description}>
          The admin page you're looking for doesn't exist or may have been moved.
        </Text>

        <View style={styles.actions}>
          <TouchableOpacity style={styles.primaryButton} onPress={handleGoToDashboard}>
            <MaterialIcons name="dashboard" size={20} color="#ffffff" />
            <Text style={styles.primaryButtonText}>Go to Dashboard</Text>
          </TouchableOpacity>
          
          <TouchableOpacity style={styles.secondaryButton} onPress={handleGoBack}>
            <MaterialIcons name="arrow-back" size={20} color="#00dc50" />
            <Text style={styles.secondaryButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.helpSection}>
          <Text style={styles.helpText}>Need help?</Text>
          <TouchableOpacity onPress={() => router.push(ROUTES.ADMIN.SUPPORT.INDEX as any)}>
            <Text style={styles.helpLink}>Visit Support Center</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#008e2a',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  iconContainer: {
    marginBottom: 24,
  },
  errorCode: {
    fontSize: 64,
    fontWeight: '800',
    color: '#00dc50',
    marginBottom: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 12,
  },
  description: {
    fontSize: 15,
    color: 'rgba(255,254,245,0.6)',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 40,
  },
  actions: {
    width: '100%',
    gap: 12,
    marginBottom: 40,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#008e2a',
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    gap: 10,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
  },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,142,42,0.15)',
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    gap: 10,
    borderWidth: 1,
    borderColor: 'rgba(0,142,42,0.3)',
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#00dc50',
  },
  helpSection: {
    alignItems: 'center',
    gap: 4,
  },
  helpText: {
    fontSize: 14,
    color: 'rgba(255,254,245,0.5)',
  },
  helpLink: {
    fontSize: 14,
    color: '#00dc50',
    fontWeight: '500',
  },
});
