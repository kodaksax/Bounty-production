// app/in-progress/[bountyId]/hunter/index.tsx - Hunter flow entry point
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { bountyRequestService } from '../../../../lib/services/bounty-request-service';
import { bountyService } from '../../../../lib/services/bounty-service';
import { getCurrentUserId } from '../../../../lib/utils/data-utils';

export default function HunterFlowIndex() {
  const { bountyId } = useLocalSearchParams<{ bountyId?: string }>();
  const router = useRouter();
  const currentUserId = getCurrentUserId();
  const [isLoading, setIsLoading] = useState(true);

  const routeBountyId = React.useMemo(() => {
    const raw = Array.isArray(bountyId) ? bountyId[0] : bountyId;
    return raw && String(raw).trim().length > 0 ? String(raw) : null;
  }, [bountyId]);

  useEffect(() => {
    if (!routeBountyId) {
      router.back();
      return;
    }
    determineStage(routeBountyId);
  }, [routeBountyId]);

  const determineStage = async (id: string) => {
    try {
      setIsLoading(true);

      // Load bounty
      const bounty = await bountyService.getById(id);
      if (!bounty) {
        router.back();
        return;
      }

      // Check if hunter has a request for this bounty
      const requests = await bountyRequestService.getAll({
        bountyId: id,
        userId: currentUserId,
      });

      if (requests.length === 0) {
        // No request - shouldn't happen, redirect back
        router.back();
        return;
      }

      const hunterRequest = requests[0];

      // Route based on request status and bounty status
      if (hunterRequest.status === 'pending') {
        // Waiting for selection
        router.replace({
          pathname: '/in-progress/[bountyId]/hunter/apply',
          params: { bountyId: id },
        });
      } else if (hunterRequest.status === 'accepted') {
        // Check bounty status to determine stage
        if (bounty.status === 'completed') {
          // Payout stage
          router.replace({
            pathname: '/in-progress/[bountyId]/hunter/payout',
            params: { bountyId: id },
          });
        } else {
          // Default to work in progress
          // In a real implementation, you might check for submission status
          router.replace({
            pathname: '/in-progress/[bountyId]/hunter/work-in-progress',
            params: { bountyId: id },
          });
        }
      } else {
        // Rejected or other status - go back
        router.back();
      }
    } catch (err) {
      console.error('Error determining stage:', err);
      router.back();
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#10b981" />
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  container: {
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
