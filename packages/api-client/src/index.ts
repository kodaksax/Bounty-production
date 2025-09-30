// Export the main API client
export { ApiClient } from './client';

// Export all React hooks
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

// Export all types
export type {
  // Core types
  ApiResponse,
  PaginatedResponse,
  ApiClientConfig,
  AuthTokens,
  PaginationInfo,
  
  // Request types
  GetBountiesOptions,
  CreateBountyRequest,
  AcceptBountyRequest,
  CompleteBountyRequest,
  
  // Entity types
  BountyRequest,
  BountyWithRequest,
  
  // Re-exported domain types
  Bounty,
  Money,
  BountyStatus,
} from './types';

// Default export for convenience
export { ApiClient as default } from './client';