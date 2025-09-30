/**
 * Sample integration stub for the BountyExpo API client
 * 
 * This demonstrates how the existing services can be replaced or work alongside
 * the new typed API client package.
 */

// Import the API client types and functions
import type { 
  CreateBountyRequest, 
  GetBountiesOptions, 
  ApiResponse, 
  PaginatedResponse,
  Bounty,
  BountyRequest 
} from '../../packages/api-client/src/types';
import { ApiClient } from '../../packages/api-client/src/client';

// Current user ID from existing utils (you might need to adjust this import)
const CURRENT_USER_ID = "00000000-0000-0000-0000-000000000001"; // Fallback constant

// Create the API client instance
export const bountyApiClient = new ApiClient({
  baseUrl: 'https://your-hostinger-domain.com',
  timeout: 30000,
  retries: 3,
  
  // Token management - in a real app, these would come from your auth system
  getAccessToken: () => {
    // Get from AsyncStorage, SecureStore, or your auth context
    if (typeof window !== 'undefined') {
      return localStorage.getItem('access_token'); // Web example
    }
    return null; // Mobile - would use AsyncStorage
  },
  
  getRefreshToken: () => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('refresh_token'); // Web example
    }
    return null; // Mobile - would use AsyncStorage
  },
  
  onTokenRefresh: (tokens) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('access_token', tokens.accessToken);
      localStorage.setItem('refresh_token', tokens.refreshToken);
    }
    // Mobile - would use AsyncStorage.setItem
  },
});

/**
 * Example service functions that use the API client
 * These can replace or supplement the existing services in lib/services/
 */
export class BountyApiService {
  
  /**
   * Get bounties with better typing and error handling
   */
  static async getBounties(options: GetBountiesOptions = {}) {
    try {
      const response = await bountyApiClient.getBounties(options);
      
      if (response.success) {
        return {
          bounties: response.data,
          pagination: response.pagination,
          error: null,
        };
      } else {
        console.error('Failed to fetch bounties:', response.error);
        return {
          bounties: [],
          pagination: {
            page: options.page || 1,
            limit: options.limit || 20,
            total: 0,
            totalPages: 0,
          },
          error: response.error || 'Failed to fetch bounties',
        };
      }
    } catch (error) {
      console.error('Error fetching bounties:', error);
      return {
        bounties: [],
        pagination: {
          page: options.page || 1,
          limit: options.limit || 20,
          total: 0,
          totalPages: 0,
        },
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Create a bounty with proper validation and error handling
   */
  static async createBounty(bountyData: CreateBountyRequest) {
    try {
      const response = await bountyApiClient.createBounty(bountyData);
      
      if (response.success && response.data) {
        return {
          bounty: response.data,
          error: null,
        };
      } else {
        return {
          bounty: null,
          error: response.error || 'Failed to create bounty',
        };
      }
    } catch (error) {
      console.error('Error creating bounty:', error);
      return {
        bounty: null,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Accept a bounty with proper response handling
   */
  static async acceptBounty(bountyId: number, message?: string) {
    try {
      const response = await bountyApiClient.acceptBounty({
        bountyId,
        message,
      });
      
      if (response.success && response.data) {
        return {
          request: response.data,
          error: null,
        };
      } else {
        return {
          request: null,
          error: response.error || 'Failed to accept bounty',
        };
      }
    } catch (error) {
      console.error('Error accepting bounty:', error);
      return {
        request: null,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Complete a bounty with completion notes
   */
  static async completeBounty(bountyId: number, completionNotes?: string) {
    try {
      const response = await bountyApiClient.completeBounty({
        bountyId,
        completionNotes,
      });
      
      if (response.success && response.data) {
        return {
          bounty: response.data,
          error: null,
        };
      } else {
        return {
          bounty: null,
          error: response.error || 'Failed to complete bounty',
        };
      }
    } catch (error) {
      console.error('Error completing bounty:', error);
      return {
        bounty: null,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}

/**
 * Migration utility to gradually replace existing service calls
 * 
 * Usage in existing components:
 * 
 * // Before:
 * const bounties = await bountyService.getAll();
 * 
 * // After:
 * const { bounties, error } = await BountyApiService.getBounties();
 */
export const migrationHelpers = {
  /**
   * Wrapper that matches the existing bountyService.getAll() signature
   */
  async getAll(options?: { status?: string; userId?: string; workType?: 'online' | 'in_person' }) {
    const { bounties } = await BountyApiService.getBounties(options);
    return bounties;
  },

  /**
   * Wrapper that matches the existing bountyService.create() signature
   */
  async create(bounty: Omit<CreateBountyRequest, 'user_id'> & { user_id?: string }) {
    const { bounty: createdBounty } = await BountyApiService.createBounty({
      ...bounty,
      // Ensure required fields have defaults
      location: bounty.location || '',
      timeline: bounty.timeline || '',
      skills_required: bounty.skills_required || '',
    });
    return createdBounty;
  },
};

// Export for use in existing screens
export default BountyApiService;