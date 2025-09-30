import { useState, useEffect, useCallback, useMemo } from 'react';
import { ApiClient } from './client';
import type { 
  Bounty, 
  BountyRequest, 
  CreateBountyRequest, 
  GetBountiesOptions, 
  AcceptBountyRequest, 
  CompleteBountyRequest,
  ApiClientConfig,
  PaginatedResponse 
} from './types';

// Hook state types
interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

interface PaginatedState<T> {
  data: T[];
  loading: boolean;
  error: string | null;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// Create a context for the API client (optional)
let globalApiClient: ApiClient | null = null;

export function createApiClient(config: ApiClientConfig): ApiClient {
  globalApiClient = new ApiClient(config);
  return globalApiClient;
}

export function useApiClient(): ApiClient {
  if (!globalApiClient) {
    throw new Error('API client not initialized. Call createApiClient() first.');
  }
  return globalApiClient;
}

/**
 * Hook to fetch bounties with pagination and filtering
 */
export function useGetBounties(options: GetBountiesOptions = {}) {
  const apiClient = useApiClient();
  const [state, setState] = useState<PaginatedState<Bounty>>({
    data: [],
    loading: false,
    error: null,
    pagination: {
      page: options.page || 1,
      limit: options.limit || 20,
      total: 0,
      totalPages: 0,
    },
  });

  const fetchBounties = useCallback(async (fetchOptions: GetBountiesOptions = {}) => {
    setState(prev => ({ ...prev, loading: true, error: null }));
    
    try {
      const response = await apiClient.getBounties(fetchOptions);
      
      if (response.success) {
        setState({
          data: response.data,
          loading: false,
          error: null,
          pagination: response.pagination,
        });
      } else {
        setState(prev => ({
          ...prev,
          loading: false,
          error: response.error || 'Failed to fetch bounties',
        }));
      }
    } catch (error) {
      setState(prev => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }));
    }
  }, [apiClient]);

  const refresh = useCallback(() => {
    fetchBounties(options);
  }, [fetchBounties, options]);

  const loadMore = useCallback(() => {
    if (state.pagination.page < state.pagination.totalPages && !state.loading) {
      fetchBounties({
        ...options,
        page: state.pagination.page + 1,
      });
    }
  }, [fetchBounties, options, state.pagination, state.loading]);

  useEffect(() => {
    fetchBounties(options);
  }, [fetchBounties, JSON.stringify(options)]);

  return {
    ...state,
    refresh,
    loadMore,
    hasMore: state.pagination.page < state.pagination.totalPages,
  };
}

/**
 * Hook to create a bounty
 */
export function useCreateBounty() {
  const apiClient = useApiClient();
  const [state, setState] = useState<AsyncState<Bounty>>({
    data: null,
    loading: false,
    error: null,
  });

  const createBounty = useCallback(async (bountyData: CreateBountyRequest) => {
    setState({ data: null, loading: true, error: null });
    
    try {
      const response = await apiClient.createBounty(bountyData);
      
      if (response.success && response.data) {
        setState({
          data: response.data,
          loading: false,
          error: null,
        });
        return response.data;
      } else {
        setState({
          data: null,
          loading: false,
          error: response.error || 'Failed to create bounty',
        });
        return null;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setState({
        data: null,
        loading: false,
        error: errorMessage,
      });
      return null;
    }
  }, [apiClient]);

  const reset = useCallback(() => {
    setState({ data: null, loading: false, error: null });
  }, []);

  return {
    ...state,
    createBounty,
    reset,
  };
}

/**
 * Hook to accept a bounty
 */
export function useAcceptBounty() {
  const apiClient = useApiClient();
  const [state, setState] = useState<AsyncState<BountyRequest>>({
    data: null,
    loading: false,
    error: null,
  });

  const acceptBounty = useCallback(async (request: AcceptBountyRequest) => {
    setState({ data: null, loading: true, error: null });
    
    try {
      const response = await apiClient.acceptBounty(request);
      
      if (response.success && response.data) {
        setState({
          data: response.data,
          loading: false,
          error: null,
        });
        return response.data;
      } else {
        setState({
          data: null,
          loading: false,
          error: response.error || 'Failed to accept bounty',
        });
        return null;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setState({
        data: null,
        loading: false,
        error: errorMessage,
      });
      return null;
    }
  }, [apiClient]);

  const reset = useCallback(() => {
    setState({ data: null, loading: false, error: null });
  }, []);

  return {
    ...state,
    acceptBounty,
    reset,
  };
}

/**
 * Hook to complete a bounty
 */
export function useCompleteBounty() {
  const apiClient = useApiClient();
  const [state, setState] = useState<AsyncState<Bounty>>({
    data: null,
    loading: false,
    error: null,
  });

  const completeBounty = useCallback(async (request: CompleteBountyRequest) => {
    setState({ data: null, loading: true, error: null });
    
    try {
      const response = await apiClient.completeBounty(request);
      
      if (response.success && response.data) {
        setState({
          data: response.data,
          loading: false,
          error: null,
        });
        return response.data;
      } else {
        setState({
          data: null,
          loading: false,
          error: response.error || 'Failed to complete bounty',
        });
        return null;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setState({
        data: null,
        loading: false,
        error: errorMessage,
      });
      return null;
    }
  }, [apiClient]);

  const reset = useCallback(() => {
    setState({ data: null, loading: false, error: null });
  }, []);

  return {
    ...state,
    completeBounty,
    reset,
  };
}

/**
 * Hook to fetch a single bounty by ID
 */
export function useGetBounty(id: number | null) {
  const apiClient = useApiClient();
  const [state, setState] = useState<AsyncState<Bounty>>({
    data: null,
    loading: false,
    error: null,
  });

  const fetchBounty = useCallback(async (bountyId: number) => {
    setState(prev => ({ ...prev, loading: true, error: null }));
    
    try {
      const response = await apiClient.getBounty(bountyId);
      
      if (response.success && response.data) {
        setState({
          data: response.data,
          loading: false,
          error: null,
        });
      } else {
        setState({
          data: null,
          loading: false,
          error: response.error || 'Failed to fetch bounty',
        });
      }
    } catch (error) {
      setState({
        data: null,
        loading: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }, [apiClient]);

  const refresh = useCallback(() => {
    if (id) {
      fetchBounty(id);
    }
  }, [fetchBounty, id]);

  useEffect(() => {
    if (id) {
      fetchBounty(id);
    }
  }, [fetchBounty, id]);

  return {
    ...state,
    refresh,
  };
}

/**
 * Generic mutation hook for any async operation
 */
export function useMutation<TData, TVariables>(
  mutationFn: (variables: TVariables) => Promise<TData | null>
) {
  const [state, setState] = useState<AsyncState<TData>>({
    data: null,
    loading: false,
    error: null,
  });

  const mutate = useCallback(async (variables: TVariables) => {
    setState({ data: null, loading: true, error: null });
    
    try {
      const result = await mutationFn(variables);
      setState({
        data: result,
        loading: false,
        error: null,
      });
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setState({
        data: null,
        loading: false,
        error: errorMessage,
      });
      return null;
    }
  }, [mutationFn]);

  const reset = useCallback(() => {
    setState({ data: null, loading: false, error: null });
  }, []);

  return {
    ...state,
    mutate,
    reset,
  };
}