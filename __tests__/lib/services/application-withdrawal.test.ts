// __tests__/lib/services/application-withdrawal.test.ts
//
// Contract for lib/services/application-withdrawal.ts — the shared
// "hunter retracts a pending application" operation used by
// app/tabs/postings-screen.tsx and app/tabs/inbox-screen.tsx.
//
// The one behaviour that matters: `application_withdrawn` fires ONLY after the
// delete is confirmed — never on a lookup miss, a failed delete, or a thrown
// error.

jest.mock('../../../lib/services/analytics-service', () => ({
  analyticsService: { trackEvent: jest.fn().mockResolvedValue(undefined) },
}));

jest.mock('../../../lib/services/bounty-request-service', () => ({
  bountyRequestService: {
    getAll: jest.fn(),
    delete: jest.fn(),
  },
}));

import { withdrawApplication } from '../../../lib/services/application-withdrawal';
import { analyticsService } from '../../../lib/services/analytics-service';
import { bountyRequestService } from '../../../lib/services/bounty-request-service';

const mockGetAll = bountyRequestService.getAll as jest.Mock;
const mockDelete = bountyRequestService.delete as jest.Mock;
const mockTrack = analyticsService.trackEvent as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('withdrawApplication', () => {
  it('deletes the pending request and emits application_withdrawn on success', async () => {
    mockGetAll.mockResolvedValue([{ id: 'req-42' }]);
    mockDelete.mockResolvedValue(true);

    const result = await withdrawApplication({
      bountyId: 7,
      currentUserId: 'hunter-1',
      surface: 'my_postings',
    });

    expect(mockGetAll).toHaveBeenCalledWith({ bountyId: '7', userId: 'hunter-1' });
    expect(mockDelete).toHaveBeenCalledWith('req-42');
    expect(result).toEqual({ applicationId: 'req-42' });
    expect(mockTrack).toHaveBeenCalledWith('application_withdrawn', {
      role: 'hunter',
      bounty_id: '7',
      application_id: 'req-42',
      surface: 'my_postings',
    });
  });

  it('passes the caller surface through to the event', async () => {
    mockGetAll.mockResolvedValue([{ id: 'req-1' }]);
    mockDelete.mockResolvedValue(true);

    await withdrawApplication({
      bountyId: 'b-1',
      currentUserId: 'hunter-1',
      surface: 'inbox',
    });

    expect(mockTrack).toHaveBeenCalledWith(
      'application_withdrawn',
      expect.objectContaining({ surface: 'inbox' })
    );
  });

  it('throws and does NOT emit when no application exists', async () => {
    mockGetAll.mockResolvedValue([]);

    await expect(
      withdrawApplication({ bountyId: 7, currentUserId: 'hunter-1', surface: 'inbox' })
    ).rejects.toThrow('No application found for this bounty');

    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockTrack).not.toHaveBeenCalled();
  });

  it('throws and does NOT emit when the delete reports failure', async () => {
    mockGetAll.mockResolvedValue([{ id: 'req-9' }]);
    mockDelete.mockResolvedValue(false);

    await expect(
      withdrawApplication({ bountyId: 7, currentUserId: 'hunter-1', surface: 'inbox' })
    ).rejects.toThrow('Failed to withdraw application');

    expect(mockTrack).not.toHaveBeenCalled();
  });

  it('propagates a thrown delete error without emitting', async () => {
    mockGetAll.mockResolvedValue([{ id: 'req-9' }]);
    mockDelete.mockRejectedValue(new Error('network down'));

    await expect(
      withdrawApplication({ bountyId: 7, currentUserId: 'hunter-1', surface: 'inbox' })
    ).rejects.toThrow('network down');

    expect(mockTrack).not.toHaveBeenCalled();
  });

  it('does not reject the caller if the analytics emit rejects', async () => {
    mockGetAll.mockResolvedValue([{ id: 'req-9' }]);
    mockDelete.mockResolvedValue(true);
    mockTrack.mockRejectedValueOnce(new Error('posthog down'));

    await expect(
      withdrawApplication({ bountyId: 7, currentUserId: 'hunter-1', surface: 'inbox' })
    ).resolves.toEqual({ applicationId: 'req-9' });
  });
});
