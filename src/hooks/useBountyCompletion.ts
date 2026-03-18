import { useState, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { bountyApi } from '../api/bounty';
import { chatApi } from '../api/chat';
import { BountyStatus } from '../types/bounty';

interface UseBountyCompletionOptions {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

interface CompleteBountyParams {
  bountyId: string;
  deleteMessages?: boolean;
  deleteEntireChat?: boolean;
}

export const useBountyCompletion = (options: UseBountyCompletionOptions = {}) => {
  const [isCompleting, setIsCompleting] = useState(false);
  const [showCompletionModal, setShowCompletionModal] = useState(false);
  const [selectedBountyId, setSelectedBountyId] = useState<string | null>(null);
  
  const queryClient = useQueryClient();

  const completeBountyMutation = useMutation({
    mutationFn: async ({ bountyId, deleteMessages, deleteEntireChat }: CompleteBountyParams) => {
      setIsCompleting(true);
      
      try {
        // Complete the bounty first
        const completedBounty = await bountyApi.updateStatus(bountyId, BountyStatus.COMPLETED);
        
        // Handle chat deletion if requested
        if (deleteEntireChat) {
          await chatApi.deleteChat(bountyId);
        } else if (deleteMessages) {
          await chatApi.deleteMessages(bountyId);
        }
        
        return completedBounty;
      } finally {
        setIsCompleting(false);
      }
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['bounties'] });
      queryClient.invalidateQueries({ queryKey: ['bounty', data.id] });
      queryClient.invalidateQueries({ queryKey: ['chat', data.id] });
      
      setShowCompletionModal(false);
      setSelectedBountyId(null);
      options.onSuccess?.();
    },
    onError: (error: Error) => {
      setIsCompleting(false);
      options.onError?.(error);
    },
  });

  const initiateBountyCompletion = useCallback((bountyId: string) => {
    setSelectedBountyId(bountyId);
    setShowCompletionModal(true);
  }, []);

  const completeBounty = useCallback((params: CompleteBountyParams) => {
    completeBountyMutation.mutate(params);
  }, [completeBountyMutation]);

  const cancelCompletion = useCallback(() => {
    setShowCompletionModal(false);
    setSelectedBountyId(null);
  }, []);

  return {
    isCompleting,
    showCompletionModal,
    selectedBountyId,
    initiateBountyCompletion,
    completeBounty,
    cancelCompletion,
    isError: completeBountyMutation.isError,
    error: completeBountyMutation.error,
  };
};