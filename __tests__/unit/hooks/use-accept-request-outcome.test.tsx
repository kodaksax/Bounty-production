// useAcceptRequest now RETURNS what happened, so a screen can show
// "You've chosen Ada" only for a hire the server actually confirmed.
//
// On 14 Nov a senior persona tapped Hire, watched a spinner and quit, unsure
// she had hired anyone; the hook resolved the same way for success and every
// failure, so nothing upstream could tell. These cases pin the contract:
// `accepted: true` only after acceptRequest returned the accepted row.

import { act, renderHook } from '@testing-library/react-native';
import { Alert } from 'react-native';

const mockAcceptRequest = jest.fn();
const mockRpc = jest.fn().mockResolvedValue({ data: 'conv-1', error: null });

jest.mock('lib/services/bounty-request-service', () => ({
  bountyRequestService: { acceptRequest: (...a: unknown[]) => mockAcceptRequest(...a) },
}));
jest.mock('lib/services/bounty-service', () => ({ bountyService: { getById: jest.fn() } }));
jest.mock('lib/services/message-service', () => ({
  messageService: {
    getOrCreateConversation: jest.fn().mockRejectedValue(new Error('offline')),
    sendMessage: jest.fn().mockResolvedValue(undefined),
  },
}));
jest.mock('lib/services/analytics-service', () => ({ analyticsService: { trackEvent: jest.fn() } }));
jest.mock('lib/services/monitoring', () => ({ logClientError: jest.fn(), logClientInfo: jest.fn() }));
jest.mock('lib/services/navigation-intent', () => ({
  navigationIntent: { setPendingConversationId: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('lib/services/supabase-messaging', () => ({ sendMessage: jest.fn().mockResolvedValue(undefined) }));
jest.mock('lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: { rpc: (...a: unknown[]) => mockRpc(...a) },
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { useAcceptRequest } = require('hooks/useAcceptRequest');

const REQUEST = {
  id: 'req-1',
  bounty_id: 'b1',
  hunter_id: 'hunter-1',
  status: 'pending',
  profile: { username: 'Ada' },
  bounty: { id: 'b1', title: 'Walk my dog', amount: 50, is_for_honor: false, funding_mode: 'at_accept' },
};

function setup(params: Record<string, unknown> = {}) {
  const noop = jest.fn();
  const asyncNoop = jest.fn().mockResolvedValue(undefined);
  const { result } = renderHook(() =>
    useAcceptRequest({
      currentUserId: 'poster-1',
      bountyRequests: [REQUEST],
      myBounties: [],
      setBountyRequests: noop,
      setMyBounties: noop,
      setInProgressBounties: noop,
      setIsLoading: noop,
      setError: noop,
      loadMyBounties: asyncNoop,
      loadInProgress: asyncNoop,
      loadRequestsForMyBounties: asyncNoop,
      setActiveScreen: noop,
      showSuccessAlert: false,
      ...params,
    })
  );
  return result;
}

async function accept(result: ReturnType<typeof setup>) {
  let outcome: any;
  await act(async () => {
    outcome = await result.current.handleAcceptRequest('req-1');
  });
  return outcome;
}

beforeEach(() => {
  mockAcceptRequest.mockReset();
  mockRpc.mockClear();
  mockRpc.mockResolvedValue({ data: 'conv-1', error: null });
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => {
  (Alert.alert as jest.Mock).mockRestore?.();
});

test('a confirmed acceptance returns accepted, with who and the conversation', async () => {
  mockAcceptRequest.mockResolvedValue({ id: 'req-1', status: 'accepted' });
  const outcome = await accept(setup({ ensureFunded: jest.fn().mockResolvedValue(true) }));
  expect(outcome).toEqual({
    accepted: true,
    bountyId: 'b1',
    hunterId: 'hunter-1',
    hunterName: 'Ada',
    conversationId: 'conv-1',
  });
});

test('backing out of the pay sheet is not a hire', async () => {
  const outcome = await accept(setup({ ensureFunded: jest.fn().mockResolvedValue(false) }));
  expect(outcome).toEqual({ accepted: false, reason: 'declined_payment' });
  expect(mockAcceptRequest).not.toHaveBeenCalled();
});

test('a refused acceptance is not a hire', async () => {
  mockAcceptRequest.mockRejectedValue(Object.assign(new Error('conflict'), { status: 409 }));
  const outcome = await accept(setup({ ensureFunded: jest.fn().mockResolvedValue(true) }));
  expect(outcome).toEqual({ accepted: false, reason: 'failed' });
});

test('a server that answers with no row (already moved on) is not a hire', async () => {
  mockAcceptRequest.mockResolvedValue(null);
  const outcome = await accept(setup({ ensureFunded: jest.fn().mockResolvedValue(true) }));
  expect(outcome).toEqual({ accepted: false, reason: 'already_moved_on' });
});

test('an unknown request is an error, not a hire', async () => {
  const result = setup();
  let outcome: any;
  await act(async () => {
    outcome = await result.current.handleAcceptRequest('nope');
  });
  expect(outcome).toEqual({ accepted: false, reason: 'error' });
});

test('a hire whose chat could not be set up is still a hire, and stays quiet when asked', async () => {
  mockAcceptRequest.mockResolvedValue({ id: 'req-1', status: 'accepted' });
  mockRpc.mockResolvedValue({ data: null, error: new Error('rpc down') });
  const outcome = await accept(
    setup({ ensureFunded: jest.fn().mockResolvedValue(true), showMessagingSetupAlert: false })
  );
  expect(outcome).toEqual(expect.objectContaining({ accepted: true, conversationId: null }));
  // The screen's own confirmation offers "Message Ada", which retries.
  expect(Alert.alert).not.toHaveBeenCalled();
});

test('existing callers keep the messaging-setup alert by default', async () => {
  mockAcceptRequest.mockResolvedValue({ id: 'req-1', status: 'accepted' });
  mockRpc.mockResolvedValue({ data: null, error: new Error('rpc down') });
  await accept(setup({ ensureFunded: jest.fn().mockResolvedValue(true) }));
  expect((Alert.alert as jest.Mock).mock.calls[0][0]).toBe('Bounty Accepted - Messaging Setup Needed');
});
