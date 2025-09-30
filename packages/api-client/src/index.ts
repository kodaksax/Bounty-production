// Main exports for the API client package
export { ApiClient } from './client';
export {
  createApiClient,
  useApiClient,
  useGetBounties,
  useCreateBounty,
  useAcceptBounty,
  useCompleteBounty,
  useGetBounty,
  useMutation,
} from './hooks';

export type {
  // Core types
  Bounty,
  BountyRequest,
  Money,
  
  // Request types
  CreateBountyRequest,
  GetBountiesOptions,
  AcceptBountyRequest,
  CompleteBountyRequest,
  
  // Response types
  ApiResponse,
  PaginatedResponse,
  
  // Config types
  ApiClientConfig,
  AuthTokens,
} from './types';

import type { ApiClientConfig } from './types';
import { ApiClient } from './client';

// Default configuration
export const defaultConfig: Partial<ApiClientConfig> = {
  timeout: 30000,
  retries: 3,
};

// Utility functions
export const createBountyClient = (baseUrl: string, options?: Partial<ApiClientConfig>) => {
  return new ApiClient({
    baseUrl,
    ...defaultConfig,
    ...options,
  });
};