/**
 * usePosterJobOffers (the job page's offers). Found by the 16 Nov senior swarm:
 * the job loads after the hook mounts, and while its first offers read was in
 * flight the section said "No offers yet" under "3 people offered to help".
 * It must say "loading" until a read for THIS job has come back, and an empty
 * reply while offers are known to exist is a failed read, not "none".
 */
import { act, renderHook } from '@testing-library/react-native';

const mockGetAllWithDetails = jest.fn();
jest.mock('../../../lib/services/bounty-request-service', () => ({
  bountyRequestService: { getAllWithDetails: (...a: unknown[]) => mockGetAllWithDetails(...a) },
}));
jest.mock('../../../hooks/use-auth-context', () => ({ useAuthContext: () => ({ session: null }) }));
jest.mock('../../../lib/wallet-context', () => ({ useWallet: () => ({ refreshFromApi: jest.fn() }) }));
jest.mock('../../../hooks/useAcceptFunding', () => ({
  useAcceptFunding: () => ({ gate: { active: false }, ensureFunded: jest.fn(), handleAcceptFailure: jest.fn() }),
}));
jest.mock('../../../hooks/useAcceptRequest', () => ({ useAcceptRequest: () => ({ handleAcceptRequest: jest.fn() }) }));
jest.mock('../../../hooks/useRejectRequest', () => ({ useRejectRequest: () => ({ handleRejectRequest: jest.fn() }) }));
jest.mock('../../../hooks/useAskApplicant', () => ({
  useAskApplicant: () => ({ handleAskApplicant: jest.fn(), askingRequestId: null, isAskApplicantBusy: false }),
}));

import { usePosterJobOffers } from '../../../hooks/usePosterJobOffers';

const BOUNTY = { id: 'b1', status: 'open' } as any;
const offer = (id: string, created_at: string) => ({ id, created_at, bounty_id: 'b1', status: 'pending' });

function setup(initial: { bounty: any; enabled: boolean; expectedCount: number }) {
  return renderHook((p: typeof initial) =>
    usePosterJobOffers({ bounty: p.bounty, viewerId: 'poster-1', enabled: p.enabled, expectedCount: p.expectedCount, onChanged: jest.fn() }),
    { initialProps: initial }
  );
}

beforeEach(() => mockGetAllWithDetails.mockReset());

test('stays "loading" from the moment the job arrives until its offers come back', async () => {
  let resolve: (rows: unknown[]) => void = () => {};
  mockGetAllWithDetails.mockReturnValue(new Promise(r => (resolve = r)));
  const { result, rerender } = setup({ bounty: null, enabled: false, expectedCount: 0 });
  // The job arrives (with 3 known offers) after mount.
  await act(async () => {
    rerender({ bounty: BOUNTY, enabled: true, expectedCount: 3 });
  });
  expect(result.current.loadState).toBe('loading');
  expect(result.current.offers).toEqual([]);
  await act(async () => {
    resolve([offer('r2', '2026-11-15T10:00:00Z'), offer('r1', '2026-11-14T10:00:00Z'), offer('r3', '2026-11-16T10:00:00Z')]);
  });
  expect(result.current.loadState).toBe('ready');
  // First to offer, first shown.
  expect(result.current.offers.map((o: any) => o.id)).toEqual(['r1', 'r2', 'r3']);
});

test('an empty reply while offers are known to exist is a failed read, not "no offers"', async () => {
  mockGetAllWithDetails.mockResolvedValue([]);
  const { result } = setup({ bounty: BOUNTY, enabled: true, expectedCount: 2 });
  await act(async () => {});
  expect(result.current.loadState).toBe('failed');
});

test('an empty reply with no known offers is genuinely "no offers yet"', async () => {
  mockGetAllWithDetails.mockResolvedValue([]);
  const { result } = setup({ bounty: BOUNTY, enabled: true, expectedCount: 0 });
  await act(async () => {});
  expect(result.current.loadState).toBe('ready');
  expect(result.current.offers).toEqual([]);
});

test('a thrown read is failed, and retrying shows loading again', async () => {
  mockGetAllWithDetails.mockRejectedValueOnce(new Error('offline'));
  const { result } = setup({ bounty: BOUNTY, enabled: true, expectedCount: 1 });
  await act(async () => {});
  expect(result.current.loadState).toBe('failed');
  mockGetAllWithDetails.mockResolvedValue([offer('r1', '2026-11-14T10:00:00Z')]);
  await act(async () => {
    await result.current.reload();
  });
  expect(result.current.loadState).toBe('ready');
  expect(result.current.offers).toHaveLength(1);
});

test('reads nothing for a job that is not open to offers', async () => {
  const { result } = setup({ bounty: BOUNTY, enabled: false, expectedCount: 0 });
  await act(async () => {});
  expect(mockGetAllWithDetails).not.toHaveBeenCalled();
  expect(result.current.loadState).toBe('ready');
});
