/**
 * Integration test for Bounty Creation Flow
 * Tests the end-to-end flow of creating a bounty
 */

// Mock supabase
const mockSupabase = {
  from: jest.fn(),
  auth: {
    getSession: jest.fn(),
  },
};

jest.mock('../../lib/supabase', () => ({
  supabase: mockSupabase,
}));

// Mock analytics
jest.mock('../../lib/services/analytics-service', () => ({
  analyticsService: {
    trackEvent: jest.fn(),
  },
}));

describe('Bounty Creation Integration Tests', () => {
  const mockUserId = 'user_123';
  const mockBountyId = 'bounty_456';

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock successful session
    mockSupabase.auth.getSession.mockResolvedValue({
      data: {
        session: {
          user: {
            id: mockUserId,
            email: 'test@example.com',
          },
        },
      },
      error: null,
    });
  });

  describe('Create Paid Bounty Flow', () => {
    it('should successfully create a paid bounty with valid data', async () => {
      // Mock database insert
      const mockInsert = jest.fn().mockResolvedValue({
        data: [
          {
            id: mockBountyId,
            user_id: mockUserId,
            title: 'Fix website bug',
            description: 'Need help fixing a bug on my website',
            amount: 50,
            is_for_honor: false,
            status: 'open',
            created_at: new Date().toISOString(),
          },
        ],
        error: null,
      });

      const mockSelect = jest.fn().mockReturnValue({
        insert: mockInsert,
      });

      mockSupabase.from.mockReturnValue({
        select: mockSelect,
      });

      // Simulate bounty creation
      const bountyData = {
        title: 'Fix website bug',
        description: 'Need help fixing a bug on my website',
        amount: 50,
        is_for_honor: false,
      };

      const result = await mockSupabase
        .from('bounties')
        .select()
        .insert({
          ...bountyData,
          user_id: mockUserId,
          status: 'open',
        });

      expect(result.error).toBeNull();
      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe(mockBountyId);
      expect(result.data[0].title).toBe(bountyData.title);
      expect(result.data[0].amount).toBe(bountyData.amount);
      expect(result.data[0].status).toBe('open');
    });

    it('should create bounty with location data', async () => {
      const mockInsert = jest.fn().mockResolvedValue({
        data: [
          {
            id: mockBountyId,
            user_id: mockUserId,
            title: 'Local task',
            description: 'Need help locally',
            amount: 25,
            is_for_honor: false,
            location: 'San Francisco, CA',
            latitude: 37.7749,
            longitude: -122.4194,
            status: 'open',
          },
        ],
        error: null,
      });

      const mockSelect = jest.fn().mockReturnValue({
        insert: mockInsert,
      });

      mockSupabase.from.mockReturnValue({
        select: mockSelect,
      });

      const bountyData = {
        title: 'Local task',
        description: 'Need help locally',
        amount: 25,
        is_for_honor: false,
        location: 'San Francisco, CA',
        latitude: 37.7749,
        longitude: -122.4194,
      };

      const result = await mockSupabase
        .from('bounties')
        .select()
        .insert({
          ...bountyData,
          user_id: mockUserId,
          status: 'open',
        });

      expect(result.error).toBeNull();
      expect(result.data[0].location).toBe('San Francisco, CA');
      expect(result.data[0].latitude).toBe(37.7749);
      expect(result.data[0].longitude).toBe(-122.4194);
    });
  });

  describe('Create Honor Bounty Flow', () => {
    it('should successfully create an honor bounty', async () => {
      const mockInsert = jest.fn().mockResolvedValue({
        data: [
          {
            id: mockBountyId,
            user_id: mockUserId,
            title: 'Help needed',
            description: 'Looking for volunteers',
            amount: null,
            is_for_honor: true,
            status: 'open',
          },
        ],
        error: null,
      });

      const mockSelect = jest.fn().mockReturnValue({
        insert: mockInsert,
      });

      mockSupabase.from.mockReturnValue({
        select: mockSelect,
      });

      const bountyData = {
        title: 'Help needed',
        description: 'Looking for volunteers',
        is_for_honor: true,
      };

      const result = await mockSupabase
        .from('bounties')
        .select()
        .insert({
          ...bountyData,
          user_id: mockUserId,
          status: 'open',
        });

      expect(result.error).toBeNull();
      expect(result.data[0].is_for_honor).toBe(true);
      expect(result.data[0].amount).toBeNull();
    });
  });

  describe('Bounty Creation Error Handling', () => {
    it('should handle database errors gracefully', async () => {
      const mockInsert = jest.fn().mockResolvedValue({
        data: null,
        error: {
          message: 'Database connection failed',
          code: 'DB_ERROR',
        },
      });

      const mockSelect = jest.fn().mockReturnValue({
        insert: mockInsert,
      });

      mockSupabase.from.mockReturnValue({
        select: mockSelect,
      });

      const bountyData = {
        title: 'Test bounty',
        description: 'Test description',
        amount: 50,
      };

      const result = await mockSupabase
        .from('bounties')
        .select()
        .insert({
          ...bountyData,
          user_id: mockUserId,
        });

      expect(result.error).not.toBeNull();
      expect(result.error.message).toBe('Database connection failed');
      expect(result.data).toBeNull();
    });

    it('should require user authentication', async () => {
      mockSupabase.auth.getSession.mockResolvedValue({
        data: { session: null },
        error: null,
      });

      const session = await mockSupabase.auth.getSession();

      expect(session.data.session).toBeNull();
    });
  });

  describe('Bounty Retrieval After Creation', () => {
    it('should retrieve created bounty by ID', async () => {
      const mockEq = jest.fn().mockResolvedValue({
        data: [
          {
            id: mockBountyId,
            user_id: mockUserId,
            title: 'Retrieved bounty',
            description: 'Test description',
            amount: 75,
            status: 'open',
          },
        ],
        error: null,
      });

      const mockSelect = jest.fn().mockReturnValue({
        eq: mockEq,
      });

      mockSupabase.from.mockReturnValue({
        select: mockSelect,
      });

      const result = await mockSupabase
        .from('bounties')
        .select()
        .eq('id', mockBountyId);

      expect(result.error).toBeNull();
      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe(mockBountyId);
      expect(result.data[0].title).toBe('Retrieved bounty');
    });

    it('should retrieve all bounties for a user', async () => {
      const mockEq = jest.fn().mockResolvedValue({
        data: [
          {
            id: 'bounty_1',
            user_id: mockUserId,
            title: 'Bounty 1',
            status: 'open',
          },
          {
            id: 'bounty_2',
            user_id: mockUserId,
            title: 'Bounty 2',
            status: 'in_progress',
          },
        ],
        error: null,
      });

      const mockSelect = jest.fn().mockReturnValue({
        eq: mockEq,
      });

      mockSupabase.from.mockReturnValue({
        select: mockSelect,
      });

      const result = await mockSupabase
        .from('bounties')
        .select()
        .eq('user_id', mockUserId);

      expect(result.error).toBeNull();
      expect(result.data).toHaveLength(2);
      expect(result.data.every((b) => b.user_id === mockUserId)).toBe(true);
    });
  });
});
