/**
 * useJobConversation: what counts as the two of them having talked since the
 * hire. The app sends its own message in the poster's name when someone is
 * chosen; that one never counts.
 */
import { renderHook, waitFor } from '@testing-library/react-native';
import { buildHireWelcomeMessage, isCoordinationMessage } from '../../../lib/my-jobs/hire-message';

const mockConversations = jest.fn();
const mockMessages = jest.fn();
jest.mock('../../../lib/services/supabase-messaging', () => ({
  fetchConversations: (...a: unknown[]) => mockConversations(...a),
}));
jest.mock('../../../lib/services/message-service', () => ({
  messageService: { getMessages: (...a: unknown[]) => mockMessages(...a) },
}));
jest.mock('../../../lib/services/bounty-request-service', () => ({ bountyRequestService: {} }));
jest.mock('../../../lib/services/cancellation-service', () => ({ cancellationService: {} }));
jest.mock('../../../lib/services/dispute-service', () => ({ disputeService: {} }));

import { useJobConversation } from '../../../hooks/useJobWorkspaceData';

const HIRED = '2026-11-20T10:00:00Z';
const msg = (senderId: string, text: string, createdAt: string) => ({ senderId, text, createdAt });
const WELCOME = msg('poster', buildHireWelcomeMessage('Garage'), '2026-11-20T10:00:03Z');

beforeEach(() => jest.clearAllMocks());

async function load(messages: unknown[], viewerId = 'poster') {
  mockConversations.mockResolvedValue([{ id: 'c', bountyId: 'b', isGroup: false, participantIds: ['poster', 'ada'] }]);
  mockMessages.mockResolvedValue(messages);
  const otherId = viewerId === 'poster' ? 'ada' : 'poster';
  const { result } = renderHook(() => useJobConversation({ viewerId, otherId, bountyId: 'b', since: HIRED }));
  await waitFor(() => expect(result.current.loaded).toBe(true));
  return result.current;
}

it('the automatic hire message is not talking, and is never quoted', async () => {
  const c = await load([WELCOME], 'ada');
  expect(c.firstTalk).toBeNull();
  expect(c.lastFromOther).toBeNull();
});

it('a question asked before the hire does not count', async () => {
  expect((await load([msg('poster', 'Do you have a van?', '2026-11-19T10:00:00Z'), WELCOME])).firstTalk).toBeNull();
});

it('a message after the hire is, and an unanswered one is tracked', async () => {
  const sent = msg('poster', 'Saturday?', '2026-11-20T11:00:00Z');
  const c = await load([WELCOME, sent]);
  expect(c.firstTalk?.at).toBe(sent.createdAt);
  expect(c.awaitingReplySince).toBe(sent.createdAt);
  expect((await load([WELCOME, sent, msg('ada', 'Yes', '2026-11-20T12:00:00Z')])).awaitingReplySince).toBeNull();
});

it('a failed read leaves its block out', async () => {
  mockConversations.mockRejectedValue(new Error('offline'));
  const { result } = renderHook(() => useJobConversation({ viewerId: 'poster', otherId: 'ada', bountyId: 'b' }));
  await waitFor(() => expect(result.current.loaded).toBe(true));
  expect(result.current.firstTalk).toBeNull();
});

it('reads a hire time without a zone as UTC, so a message right after the hire counts', () => {
  const sent = { text: 'Saturday?', createdAt: '2026-11-20T10:05:00+00:00' };
  expect(isCoordinationMessage(sent, '2026-11-20T10:00:00')).toBe(true);
  expect(isCoordinationMessage(sent, '2026-11-20T10:06:00')).toBe(false);
  // The same instant written the way every server row writes it must not depend on this machine's zone.
  expect(isCoordinationMessage({ text: 'x', createdAt: '2026-11-20T10:00:00Z' }, '2026-11-20T10:00:00')).toBe(true);
});

it('does not use another job’s conversation when this job has no thread', async () => {
  mockConversations.mockResolvedValue([
    { id: 'd', bountyId: 'old', isGroup: false, participantIds: ['poster', 'ada'] },
  ]);
  const { result } = renderHook(() => useJobConversation({ viewerId: 'poster', otherId: 'ada', bountyId: 'b', since: HIRED }));
  await waitFor(() => expect(result.current.loaded).toBe(true));
  expect(result.current.firstTalk).toBeNull();
  expect(mockMessages).not.toHaveBeenCalled();
});
