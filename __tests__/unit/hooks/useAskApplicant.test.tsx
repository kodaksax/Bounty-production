// Re-entrancy contract for hooks/useAskApplicant.
//
// The "Ask a question" button opens a pre-acceptance conversation with an
// applicant. The handler awaits getOrCreateConversation before it navigates, so
// a poster who taps twice used to run the whole path twice: two messenger
// screens pushed onto the stack, two applicant_question_opened events, and two
// fn_mark_poster_interacted writes. This suite pins down that a second tap while
// the first is still in flight is a no-op.

import { act, renderHook } from '@testing-library/react-native';

const mockGetOrCreate = jest.fn();
const mockTrackEvent = jest.fn();
const mockRpc = jest.fn();
const mockPush = jest.fn();

jest.mock('lib/services/message-service', () => ({
  messageService: { getOrCreateConversation: (...a: unknown[]) => mockGetOrCreate(...a) },
}));
jest.mock('lib/services/analytics-service', () => ({
  analyticsService: { trackEvent: (...a: unknown[]) => mockTrackEvent(...a) },
}));
jest.mock('lib/services/monitoring', () => ({ logClientError: jest.fn() }));
jest.mock('lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => mockRpc(...a) } }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { useAskApplicant } = require('hooks/useAskApplicant');

const request = { id: 'req-1', hunter_id: 'hunter-1', bounty_id: 'b1' };

describe('useAskApplicant re-entrancy', () => {
  beforeEach(() => {
    mockGetOrCreate.mockReset().mockResolvedValue({ id: 'conv-1' });
    mockTrackEvent.mockReset();
    mockRpc.mockReset().mockResolvedValue({ error: null });
    mockPush.mockReset();
  });

  test('a second tap while the first is in flight is ignored', async () => {
    const { result } = renderHook(() => useAskApplicant({ bountyRequests: [request] }));

    await act(async () => {
      const first = result.current.handleAskApplicant('req-1');
      const second = result.current.handleAskApplicant('req-1');
      await Promise.all([first, second]);
    });

    // Each side effect runs once, not once per tap.
    expect(mockGetOrCreate).toHaveBeenCalledTimes(1);
    expect(mockTrackEvent).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  test('the guard releases so a later tap opens the conversation again', async () => {
    const { result } = renderHook(() => useAskApplicant({ bountyRequests: [request] }));

    await act(async () => {
      await result.current.handleAskApplicant('req-1');
    });
    await act(async () => {
      await result.current.handleAskApplicant('req-1');
    });

    expect(mockPush).toHaveBeenCalledTimes(2);
  });
});
