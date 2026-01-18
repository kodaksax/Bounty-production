// app/bounty/[id]/index.tsx - Bounty detail routing entry point
// This screen determines the user's role (poster or hunter) and redirects appropriately
import { MaterialIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
    ActivityIndicator,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { bountyService } from '../../../lib/services/bounty-service';
import { bountyRequestService } from '../../../lib/services/bounty-request-service';
import type { _Bounty } from '../../../lib/services/database.types';
import { getCurrentUserId } from '../../../lib/utils/data-utils';

export default function BountyDetailRouter() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const currentUserId = getCurrentUserId();

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const routeBountyId = React.useMemo(() => {
    const raw = Array.isArray(id) ? id[0] : id;
    return raw && String(raw).trim().length > 0 ? String(raw) : null;
  }, [id]);

  const determineBountyRole = useCallback(async (bountyId: string) => {
    try {
      setIsLoading(true);
      setError(null);

      // Load bounty
      const bounty = await bountyService.getById(bountyId);
      if (!bounty) {
        setError('Bounty not found');
        return;
      }

      // Check if user is the poster
      // Note: bounty.poster_id is the canonical field, user_id is a backwards-compatible alias
      // Both are checked for compatibility with older code paths
      if (bounty.user_id === currentUserId || bounty.poster_id === currentUserId) {
        // Redirect to poster's dashboard view
        router.replace({
          pathname: '/postings/[bountyId]',
          params: { bountyId },
        });
        return;
      }

      // Check if user has a request for this bounty (hunter flow)
      const requests = await bountyRequestService.getAll({
        bountyId,
        userId: currentUserId,
      });

      if (requests.length > 0) {
        // User is a hunter with a request - redirect to hunter flow
        router.replace({
          pathname: '/in-progress/[bountyId]/hunter',
          params: { bountyId },
        });
        return;
      }

      // User has no relationship to this bounty as poster or hunter
      // The postings/[bountyId] view handles access control and shows the bounty detail
      // Non-posters will see a read-only view with option to apply
      router.replace({
        pathname: '/postings/[bountyId]',
        params: { bountyId },
      });
    } catch (err) {
      console.error('Error determining bounty role:', err);
      setError('Failed to load bounty details');
    } finally {
      setIsLoading(false);
    }
  }, [currentUserId, router]);

  useEffect(() => {
    if (!routeBountyId) {
      setError('Invalid bounty ID');
      setIsLoading(false);
      return;
    }
    determineBountyRole(routeBountyId);
  }, [routeBountyId, determineBountyRole]);

  const handleGoBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/tabs/bounty-app');
    }
  };

  if (isLoading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#a7f3d0" />
          <Text style={styles.loadingText}>Loading bounty...</Text>
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.errorContainer}>
          <MaterialIcons name="error-outline" size={64} color="rgba(255,254,245,0.5)" />
          <Text style={styles.errorTitle}>Unable to Load Bounty</Text>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.backButton} onPress={handleGoBack}>
            <MaterialIcons name="arrow-back" size={20} color="#fffef5" />
            <Text style={styles.backButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Loading spinner as fallback while redirecting
  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#a7f3d0" />
        <Text style={styles.loadingText}>Redirecting...</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a3d2e',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  loadingText: {
    color: 'rgba(255,254,245,0.8)',
    fontSize: 16,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    gap: 16,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fffef5',
  },
  errorText: {
    fontSize: 14,
    color: 'rgba(255,254,245,0.7)',
    textAlign: 'center',
    marginBottom: 16,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#059669',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    gap: 8,
  },
  backButtonText: {
    color: '#fffef5',
    fontSize: 16,
    fontWeight: '600',
  },
});
