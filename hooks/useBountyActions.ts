import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BountyService } from '../lib/services/bountyService';
import { BountyStatus } from '../lib/types';
import { useBountyUpdates } from './useBountyUpdates';
import { Alert } from 'react-native';

export function useBountyActions() {
  const queryClient = useQueryClient();
  const { invalidateBountyQueries, updateBountyInCache } = useBountyUpdates();

  const updateBountyStatus = useMutation({
    mutationFn: async ({ bountyId, status, metadata }: {
      bountyId: string;
      status: BountyStatus;
      metadata?: Record<string, any>;
    }) => {
      return await BountyService.updateBountyStatus(bountyId, status, metadata);
    },
    onMutate: async ({ bountyId, status }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['bounties'] });
      await queryClient.cancelQueries({ queryKey: ['postings'] });

      // Snapshot the previous value
      const previousBounties = queryClient.getQueryData(['bounties']);
      const previousPostings = queryClient.getQueryData(['postings']);

      // Optimistically update the cache
      queryClient.setQueriesData(
        { queryKey: ['bounties'] },
        (old: any) => {
          if (!old) return old;
          if (Array.isArray(old)) {
            return old.map(bounty => 
              bounty.id === bountyId 
                ? { ...bounty, status, updated_at: new Date().toISOString() }
                : bounty
            );
          }
          return old;
        }
      );

      queryClient.setQueriesData(
        { queryKey: ['postings'] },
        (old: any) => {
          if (!old?.pages) return old;
          return {
            ...old,
            pages: old.pages.map((page: any) => ({
              ...page,
              data: page.data?.map((item: any) => 
                item.id === bountyId 
                  ? { ...item, status, updated_at: new Date().toISOString() }
                  : item
              ) || page.data
            }))
          };
        }
      );

      return { previousBounties, previousPostings };
    },
    onSuccess: (data) => {
      console.log('Bounty status updated successfully:', data);
      updateBountyInCache(data);
      invalidateBountyQueries();
    },
    onError: (error, variables, context) => {
      console.error('Failed to update bounty status:', error);
      
      // Revert the optimistic update
      if (context?.previousBounties) {
        queryClient.setQueryData(['bounties'], context.previousBounties);
      }
      if (context?.previousPostings) {
        queryClient.setQueryData(['postings'], context.previousPostings);
      }
      
      Alert.alert(
        'Update Failed',
        'Failed to update bounty status. Please try again.',
        [{ text: 'OK' }]
      );
    },
    onSettled: () => {
      // Always refetch after error or success to ensure cache consistency
      invalidateBountyQueries();
    }
  });

  const acceptBountyRequest = useMutation({
    mutationFn: async ({ bountyId, requestId, acceptedUserId }: {
      bountyId: string;
      requestId: string;
      acceptedUserId: string;
    }) => {
      return await BountyService.acceptBountyRequest(bountyId, requestId, acceptedUserId);
    },
    onSuccess: (data) => {
      console.log('Bounty request accepted successfully:', data);
      updateBountyInCache(data.bounty);
      invalidateBountyQueries();
    },
    onError: (error) => {
      console.error('Failed to accept bounty request:', error);
      Alert.alert(
        'Accept Failed',
        'Failed to accept bounty request. Please try again.',
        [{ text: 'OK' }]
      );
    },
    onSettled: () => {
      invalidateBountyQueries();
    }
  });

  const completeBounty = useMutation({
    mutationFn: async ({ bountyId, completionData }: {
      bountyId: string;
      completionData?: Record<string, any>;
    }) => {
      return await BountyService.completeBounty(bountyId, completionData);
    },
    onSuccess: (data) => {
      console.log('Bounty completed successfully:', data);
      updateBountyInCache(data);
      invalidateBountyQueries();
    },
    onError: (error) => {
      console.error('Failed to complete bounty:', error);
      Alert.alert(
        'Completion Failed',
        'Failed to complete bounty. Please try again.',
        [{ text: 'OK' }]
      );
    },
    onSettled: () => {
      invalidateBountyQueries();
    }
  });

  return {
    updateBountyStatus,
    acceptBountyRequest,
    completeBounty,
    isUpdating: updateBountyStatus.isPending || acceptBountyRequest.isPending || completeBounty.isPending
  };
}