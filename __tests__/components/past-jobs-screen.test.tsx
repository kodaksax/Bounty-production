/**
 * Profile › Past jobs (app/profile/past-jobs.tsx, Focus-first P.1) against
 * mocked services: both sections from the two existing reads, the earnings
 * and rating facts, row and footer navigation, a poster-only account, the
 * error state, and the link from the profile screen.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import fs from 'fs';
import path from 'path';
import React from 'react';
import { calculateHunterEarnings } from '../../lib/constants/fees';
import { lightTheme } from '../../lib/themes/lightTheme';

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
const mockGetByUserId = jest.fn();
const mockOffers = jest.fn();
const mockBatch = jest.fn();
const mockStats = jest.fn();
const mockReviews = jest.fn();
let mockTransactions: unknown[] = [];

jest.mock('../../hooks/useValidUserId', () => ({ useValidUserId: () => 'me' }));
jest.mock('../../lib/themes/AppThemeContext', () => ({ useAppThemeContext: () => ({ theme: lightTheme }) }));
jest.mock('../../lib/wallet-context', () => ({ useWallet: () => ({ transactions: mockTransactions }) }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace, back: mockBack, canGoBack: () => true }),
}));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('../../lib/services/bounty-service', () => ({
  bountyService: { getByUserId: (...a: unknown[]) => mockGetByUserId(...a) },
}));
jest.mock('../../lib/services/bounty-request-service', () => ({
  bountyRequestService: {
    getAllWithDetails: (...a: unknown[]) => mockOffers(...a),
    getAllWithDetailsBatch: (...a: unknown[]) => mockBatch(...a),
  },
}));
jest.mock('../../lib/services/ratings', () => ({
  ratingsService: {
    getAggregatedStats: (...a: unknown[]) => mockStats(...a),
    getByUserId: (...a: unknown[]) => mockReviews(...a),
  },
}));

// eslint-disable-next-line import/first
import PastJobsScreen from '../../app/profile/past-jobs';

const DAY = 86_400_000;
const recent = new Date(Date.now() - 2 * DAY).toISOString();
const older = new Date(Date.now() - 40 * DAY).toISOString();

const tvJob = {
  id: 'b-1',
  title: 'Mount a TV on the wall',
  amount: 80,
  is_for_honor: false,
  status: 'completed',
  accepted_by: 'me',
  username: 'Jordan K.',
  completed_at: recent,
  created_at: older,
  category: 'labor',
};
const gateJob = {
  id: 'p-1',
  title: 'Fix a wobbly gate',
  amount: 35,
  is_for_honor: false,
  status: 'completed',
  accepted_by: 'h-1',
  poster_id: 'me',
  completed_at: older,
  created_at: older,
};
const plantsJob = {
  id: 'p-2',
  title: "Water plants while I'm away",
  amount: 25,
  is_for_honor: false,
  status: 'cancelled',
  poster_id: 'me',
  updated_at: older,
  created_at: older,
};
const openJob = { id: 'p-3', title: 'Still open', amount: 10, status: 'open', poster_id: 'me', created_at: older };

const net80 = `$${calculateHunterEarnings(80).net}`;

function bothSides() {
  mockGetByUserId.mockResolvedValue([gateJob, plantsJob, openJob]);
  mockOffers.mockResolvedValue([{ id: 'r-1', bounty_id: 'b-1', hunter_id: 'me', status: 'accepted', bounty: tvJob }]);
  mockBatch.mockResolvedValue([{ id: 'r-9', bounty_id: 'p-1', hunter_id: 'h-1', status: 'accepted', profile: { username: 'Sam T.' } }]);
  mockStats.mockResolvedValue({ averageRating: 5, ratingCount: 1 });
  mockReviews.mockResolvedValue([
    { id: 'rv-1', user_id: 'me', rater_id: 'poster-1', bountyId: 'b-1', score: 5, raterRole: 'poster', raterName: 'Jordan K.', comment: 'Quick and tidy, cables hidden.', createdAt: recent },
  ]);
  mockTransactions = [
    { id: 't-1', type: 'refund', amount: 25, date: new Date(), details: { bounty_id: 'p-2' } },
    { id: 't-2', type: 'release', amount: 80, date: new Date(), details: { bounty_id: 'b-1', settlementState: 'ledger_only' } },
    { id: 't-3', type: 'release', amount: 35, date: new Date(), details: { bounty_id: 'p-1', settlementState: 'ledger_only' } },
  ];
}

beforeEach(() => {
  jest.clearAllMocks();
  mockTransactions = [];
});

describe('Past jobs (P.1)', () => {
  it('shows both sections, the earnings and rating facts, and reads archived jobs too', async () => {
    bothSides();
    render(<PastJobsScreen />);

    const work = await screen.findByTestId('past-jobs-work');
    expect(within(work).getByText('WORK YOU DID')).toBeTruthy();
    expect(within(work).getByText('For Jordan K. · ' + new Date(recent).toLocaleDateString('en-US', { weekday: 'long' }))).toBeTruthy();
    expect(within(work).getByText(`Released · ${net80} to your wallet`)).toBeTruthy();
    expect(within(work).getByText('“Quick and tidy, cables hidden.” Jordan · 5 stars')).toBeTruthy();

    const posted = screen.getByTestId('past-jobs-posted');
    expect(within(posted).getByText('JOBS YOU POSTED')).toBeTruthy();
    expect(within(posted).getByText('Finished · $35 released to Sam')).toBeTruthy();
    expect(within(posted).getByText('Cancelled · $25 back to your balance')).toBeTruthy();
    expect(within(posted).queryByText('Still open')).toBeNull();

    const facts = screen.getByTestId('past-jobs-facts');
    expect(within(facts).getByLabelText(`Earned on Bounty: ${net80}`)).toBeTruthy();
    // One review: below the threshold, so a count and no average.
    expect(within(facts).getByLabelText('Your rating as a helper: 1 review so far')).toBeTruthy();

    expect(mockGetByUserId).toHaveBeenCalledWith('me', {
      statuses: ['completed', 'cancelled', 'archived'],
      includeArchived: true,
      limit: 100,
      offset: 0,
      throwOnError: true,
    });
    expect(mockOffers).toHaveBeenCalledWith({ userId: 'me', page: 1, pageSize: 100, throwOnError: true });
    expect(mockBatch).toHaveBeenCalledWith(['p-1'], { status: 'accepted', throwOnError: true });
    expect(mockReviews).toHaveBeenCalledWith('me', { limit: 50, offset: 0 });
  });

  it('a row opens its receipt (work you did) or its workspace (job you posted); the footer opens Wallet', async () => {
    bothSides();
    render(<PastJobsScreen />);

    fireEvent.press(await screen.findByTestId('past-job-did:b-1'));
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/in-progress/[bountyId]/hunter', params: { bountyId: 'b-1' } });

    fireEvent.press(screen.getByTestId('past-job-posted:p-1'));
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/postings/[bountyId]', params: { bountyId: 'p-1' } });

    fireEvent.press(screen.getByTestId('past-jobs-wallet'));
    expect(mockPush).toHaveBeenLastCalledWith('/tabs/bounty-app?tab=wallet');
    expect(screen.getByText('See earnings in Wallet')).toBeTruthy();

    fireEvent.press(screen.getByTestId('flow-back'));
    expect(mockBack).toHaveBeenCalled();
  });

  it('a poster-only account sees only JOBS YOU POSTED and its overall rating', async () => {
    mockGetByUserId.mockResolvedValue([gateJob]);
    mockOffers.mockResolvedValue([]);
    mockBatch.mockResolvedValue([]);
    mockStats.mockResolvedValue({ averageRating: 4.6, ratingCount: 5 });
    mockReviews.mockResolvedValue([]);
    render(<PastJobsScreen />);

    expect(await screen.findByTestId('past-jobs-posted')).toBeTruthy();
    expect(screen.queryByTestId('past-jobs-work')).toBeNull();
    expect(screen.queryByText('WORK YOU DID')).toBeNull();
    const facts = screen.getByTestId('past-jobs-facts');
    expect(within(facts).queryByText('Earned on Bounty')).toBeNull();
    expect(within(facts).getByLabelText('Your rating: 4.6 out of 5 · 5 reviews')).toBeTruthy();
  });

  it('with no past jobs at all, one plain sentence and no facts', async () => {
    mockGetByUserId.mockResolvedValue([openJob]);
    mockOffers.mockResolvedValue([]);
    mockStats.mockResolvedValue({ averageRating: 0, ratingCount: 0 });
    mockReviews.mockResolvedValue([]);
    render(<PastJobsScreen />);

    expect(await screen.findByTestId('past-jobs-empty')).toBeTruthy();
    expect(screen.queryByTestId('past-jobs-facts')).toBeNull();
    expect(mockBatch).not.toHaveBeenCalled();
  });

  it('a failed load says so and offers a button, not just pull-to-refresh', async () => {
    mockGetByUserId.mockRejectedValueOnce(new Error('offline'));
    mockOffers.mockResolvedValue([]);
    mockStats.mockResolvedValue({ averageRating: 0, ratingCount: 0 });
    mockReviews.mockResolvedValue([]);
    render(<PastJobsScreen />);

    expect(await screen.findByText("We couldn't load your past jobs")).toBeTruthy();
    bothSides();
    fireEvent.press(screen.getByTestId('past-jobs-retry'));
    await waitFor(() => expect(screen.getByTestId('past-jobs-work')).toBeTruthy());
    expect(screen.queryByText("We couldn't load your past jobs")).toBeNull();
  });
});

describe('Profile → Past jobs link', () => {
  it('the profile screen links to /profile/past-jobs, next to View history', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../app/tabs/profile-screen.tsx'), 'utf8');
    expect(src).toMatch(/router\.push\('\/profile\/past-jobs'/);
    expect(src).toMatch(/testID="profile-past-jobs"/);
    expect(src.indexOf('profile-past-jobs')).toBeLessThan(src.indexOf('View history'));
  });
});
