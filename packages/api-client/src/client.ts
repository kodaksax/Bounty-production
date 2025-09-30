import type { 
  Bounty, 
  BountyRequest, 
  CreateBountyRequest, 
  GetBountiesOptions, 
  AcceptBountyRequest, 
  CompleteBountyRequest,
  ApiResponse, 
  PaginatedResponse, 
  ApiClientConfig,
  AuthTokens 
} from './types';

export class ApiClient {
  private config: Required<Omit<ApiClientConfig, 'onTokenRefresh' | 'getAccessToken' | 'getRefreshToken'>> & 
    Pick<ApiClientConfig, 'onTokenRefresh' | 'getAccessToken' | 'getRefreshToken'>;
  private refreshPromise: Promise<boolean> | null = null;

  constructor(config: ApiClientConfig) {
    this.config = {
      timeout: 30000,
      retries: 3,
      ...config,
    };
  }

  /**
   * Make an authenticated HTTP request with automatic token refresh
   */
  private async request<T>(
    endpoint: string, 
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    const url = `${this.config.baseUrl}${endpoint}`;
    const headers = new Headers({
      'Content-Type': 'application/json',
      ...options.headers,
    });

    // Add authorization header if available
    const accessToken = this.config.getAccessToken?.();
    if (accessToken) {
      headers.set('Authorization', `Bearer ${accessToken}`);
    }

    const requestOptions: RequestInit = {
      ...options,
      headers,
    };

    try {
      const response = await this.fetchWithRetry(url, requestOptions);

      // Handle 401 - attempt token refresh
      if (response.status === 401) {
        const refreshed = await this.handleTokenRefresh();
        if (refreshed) {
          // Retry with new token
          const newAccessToken = this.config.getAccessToken?.();
          if (newAccessToken) {
            headers.set('Authorization', `Bearer ${newAccessToken}`);
            const retryResponse = await this.fetchWithRetry(url, { ...requestOptions, headers });
            return this.parseResponse<T>(retryResponse);
          }
        }
        return {
          success: false,
          error: 'Authentication failed',
        };
      }

      return await this.parseResponse<T>(response);
    } catch (error) {
      console.error('API request failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Network request failed',
      };
    }
  }

  /**
   * Fetch with retry logic
   */
  private async fetchWithRetry(url: string, options: RequestInit, attempt = 1): Promise<Response> {
    try {
      return await fetch(url, options);
    } catch (error) {
      if (attempt < this.config.retries) {
        // Exponential backoff: 1s, 2s, 4s
        const delay = Math.pow(2, attempt - 1) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.fetchWithRetry(url, options, attempt + 1);
      }
      throw error;
    }
  }

  /**
   * Parse response and handle errors
   */
  private async parseResponse<T>(response: Response): Promise<ApiResponse<T>> {
    try {
      const data = await response.json();
      
      if (!response.ok) {
        return {
          success: false,
          error: data.message || data.error || `HTTP ${response.status}`,
        };
      }

      return {
        success: true,
        data,
      };
    } catch (error) {
      return {
        success: false,
        error: 'Failed to parse response',
      };
    }
  }

  /**
   * Handle token refresh (401 response)
   */
  private async handleTokenRefresh(): Promise<boolean> {
    // Prevent multiple simultaneous refresh attempts
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this.performTokenRefresh();
    const result = await this.refreshPromise;
    this.refreshPromise = null;
    return result;
  }

  /**
   * Perform the actual token refresh
   */
  private async performTokenRefresh(): Promise<boolean> {
    const refreshToken = this.config.getRefreshToken?.();
    if (!refreshToken) {
      return false;
    }

    try {
      const response = await fetch(`${this.config.baseUrl}/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ refreshToken }),
      });

      if (response.ok) {
        const tokens: AuthTokens = await response.json();
        this.config.onTokenRefresh?.(tokens);
        return true;
      }
      return false;
    } catch (error) {
      console.error('Token refresh failed:', error);
      return false;
    }
  }

  /**
   * Get all bounties with optional filtering
   */
  async getBounties(options: GetBountiesOptions = {}): Promise<PaginatedResponse<Bounty>> {
    const searchParams = new URLSearchParams();
    
    if (options.page) searchParams.set('page', options.page.toString());
    if (options.limit) searchParams.set('limit', options.limit.toString());
    if (options.status) searchParams.set('status', options.status);
    if (options.location) searchParams.set('location', options.location);
    if (options.userId) searchParams.set('userId', options.userId);
    if (options.search) searchParams.set('search', options.search);

    const endpoint = `/api/bounties${searchParams.toString() ? `?${searchParams.toString()}` : ''}`;
    
    const response = await this.request<{ bounties: Bounty[], pagination: any }>(endpoint);
    
    if (response.success && response.data) {
      return {
        success: true,
        data: response.data.bounties,
        pagination: response.data.pagination,
      };
    }
    
    return {
      success: false,
      error: response.error,
      data: [],
      pagination: {
        page: options.page || 1,
        limit: options.limit || 20,
        total: 0,
        totalPages: 0,
      },
    };
  }

  /**
   * Create a new bounty
   */
  async createBounty(bountyData: CreateBountyRequest): Promise<ApiResponse<Bounty>> {
    return this.request<Bounty>('/api/bounties', {
      method: 'POST',
      body: JSON.stringify(bountyData),
    });
  }

  /**
   * Accept a bounty (create a bounty request)
   */
  async acceptBounty(request: AcceptBountyRequest): Promise<ApiResponse<BountyRequest>> {
    return this.request<BountyRequest>('/api/bounty-requests', {
      method: 'POST',
      body: JSON.stringify({
        bounty_id: request.bountyId,
        status: 'pending',
        message: request.message,
      }),
    });
  }

  /**
   * Complete a bounty (mark bounty as completed)
   */
  async completeBounty(request: CompleteBountyRequest): Promise<ApiResponse<Bounty>> {
    return this.request<Bounty>(`/api/bounties/${request.bountyId}/complete`, {
      method: 'POST',
      body: JSON.stringify({
        completion_note: request.completionNote,
        proof: request.proof,
      }),
    });
  }

  /**
   * Get a specific bounty by ID
   */
  async getBounty(id: number): Promise<ApiResponse<Bounty>> {
    return this.request<Bounty>(`/api/bounties/${id}`);
  }

  /**
   * Update bounty status
   */
  async updateBountyStatus(bountyId: number, status: string): Promise<ApiResponse<Bounty>> {
    return this.request<Bounty>(`/api/bounties/${bountyId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  }
}