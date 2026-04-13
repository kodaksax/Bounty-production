import { useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useQueryClient } from '@tanstack/react-query';

interface Bounty {
  id: string;
  status?: string;
  updated_at?: string;
  [key: string]: any;
}

export function useBountyUpdates() {
  const queryClient = useQueryClient();

  const invalidateBountyQueries = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['bounties'] });
    queryClient.invalidateQueries({ queryKey: ['postings'] });
    queryClient.invalidateQueries({ queryKey: ['user-bounties'] });
  }, [queryClient]);

  const updateBountyInCache = useCallback((updatedBounty: Bounty) => {
    // Update all relevant query caches
    queryClient.setQueriesData(
      { queryKey: ['bounties'] },
      (oldData: any) => {
        if (!oldData) return oldData;
        if (Array.isArray(oldData)) {
          return oldData.map(bounty => 
            bounty.id === updatedBounty.id ? updatedBounty : bounty
          );
        }
        return oldData;
      }
    );

    queryClient.setQueriesData(
      { queryKey: ['postings'] },
      (oldData: any) => {
        if (!oldData?.pages) return oldData;
        return {
          ...oldData,
          pages: oldData.pages.map((page: any) => ({
            ...page,
            data: page.data?.map((item: any) => 
              item.id === updatedBounty.id ? updatedBounty : item
            ) || page.data
          }))
        };
      }
    );
  }, [queryClient]);

  useEffect(() => {
    const channel = supabase
      .channel('bounty-updates')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'bounties'
        },
        (payload) => {
          console.log('Bounty updated:', payload);
          if (payload.new) {
            updateBountyInCache(payload.new as Bounty);
          }
          invalidateBountyQueries();
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'bounty_requests'
        },
        () => {
          console.log('Bounty request created');
          invalidateBountyQueries();
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'bounty_requests'
        },
        () => {
          console.log('Bounty request updated');
          invalidateBountyQueries();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [invalidateBountyQueries, updateBountyInCache]);

  return {
    invalidateBountyQueries,
    updateBountyInCache
  };
}