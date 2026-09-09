jest.mock('lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: {
      getSession: jest.fn().mockResolvedValue({
        data: { session: { access_token: 'test-access-token' } },
      }),
    },
    from: jest.fn(),
  },
}));

jest.mock('lib/config/api', () => ({
  API_BASE_URL: 'https://example.supabase.co/functions/v1',
}));

jest.mock('lib/utils/network', () => ({
  getReachableApiBaseUrl: jest.fn((url: string) => url),
}));

jest.mock('lib/utils/dev-host', () => jest.fn(() => 'http://localhost:3001'));
jest.mock('lib/utils/data-utils', () => ({
  CURRENT_USER_ID: 'hunter123',
  getCurrentUserId: jest.fn(() => 'hunter123'),
}));
jest.mock('lib/utils/error-logger', () => ({
  logger: { error: jest.fn(), warning: jest.fn() },
}));
jest.mock('lib/services/analytics-service', () => ({
  analyticsService: { trackEvent: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('lib/services/bounty-request-service', () => ({
  getHoursSinceClaimed: jest.fn(),
}));
jest.mock('lib/services/bounty-service', () => ({
  bountyService: { update: jest.fn() },
}));

describe('completion ready routing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: jest.fn().mockResolvedValue(''),
    }) as jest.Mock;
  });

  it('uses the service-role edge route instead of a client-side completion_ready write', async () => {
    const { completionService } = require('lib/services/completion-service');
    const { supabase } = require('lib/supabase');

    await expect(completionService.markReady('bounty123', 'hunter123')).resolves.toBe(true);

    expect(global.fetch).toHaveBeenCalledWith(
      'https://example.supabase.co/functions/v1/completion/ready',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ bounty_id: 'bounty123', hunter_id: 'hunter123' }),
      })
    );
    expect(supabase.from).not.toHaveBeenCalled();
  });
});
