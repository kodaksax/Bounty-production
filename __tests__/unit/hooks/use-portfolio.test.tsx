// The profile screen passes the 'current-user' placeholder until the auth
// profile resolves. Querying a uuid column with it was a guaranteed 400, and a
// third of all portfolio_items reads in production.

import { renderHook, waitFor } from '@testing-library/react-native';

const mockGetItems = jest.fn();
const mockMigrate = jest.fn();

jest.mock('lib/services/portfolio-service', () => ({
  portfolioService: {
    getItems: (...args: unknown[]) => mockGetItems(...args),
    addItem: jest.fn(),
    deleteItem: jest.fn(),
  },
}));
jest.mock('lib/services/portfolio-legacy-migration', () => ({
  migrateLegacyPortfolioItems: (...args: unknown[]) => mockMigrate(...args),
}));

import { usePortfolio } from '../../../hooks/usePortfolio';

const USER_ID = '27d0f1b9-ea80-4ffe-9722-63323e540f14';

describe('usePortfolio', () => {
  beforeEach(() => {
    mockGetItems.mockReset().mockResolvedValue([]);
    mockMigrate.mockReset().mockResolvedValue(undefined);
  });

  it('does not query, or run the legacy migration, for the placeholder id', async () => {
    const { result } = renderHook(() => usePortfolio('current-user', true));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockGetItems).not.toHaveBeenCalled();
    expect(mockMigrate).not.toHaveBeenCalled();
    expect(result.current.items).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('fetches once the real id arrives, and only with the real id', async () => {
    const item = { id: 'item-1' };
    mockGetItems.mockResolvedValue([item]);

    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => usePortfolio(id, true),
      { initialProps: { id: 'current-user' } }
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    rerender({ id: USER_ID });

    await waitFor(() => expect(result.current.items).toEqual([item]));
    expect(mockGetItems).toHaveBeenCalledTimes(1);
    expect(mockGetItems).toHaveBeenCalledWith(USER_ID);
    expect(mockMigrate).toHaveBeenCalledWith(USER_ID);
  });

  it('never runs the legacy migration for someone else\'s profile', async () => {
    const { result } = renderHook(() => usePortfolio(USER_ID, false));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockGetItems).toHaveBeenCalledWith(USER_ID);
    expect(mockMigrate).not.toHaveBeenCalled();
  });
});
