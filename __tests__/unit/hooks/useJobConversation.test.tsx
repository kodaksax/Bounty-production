/**
 * useJobConversation: what counts as the two of them having talked since the
 * hire. The app sends its own message in the poster's name when someone is
 * chosen; counting it would skip "agree a time" (F, H.5) on every real job.
 */
import { renderHook, waitFor } from '@testing-library/react-native';
import { buildHireWelcomeMessage } from '../../../lib/my-jobs/hire-message';

const mockConversations = jest.fn();
const mockMessages = jest.fn();
jest.mock('../../../lib/services/supabase-messaging', () => ({
  fetchConversations: (...a: unknown[]) => mockConversations(...a),
  fetchMessages: (...a: unknown[]) => mockMessages(...a),
}));
jest.mock('../../../lib/services/bounty-request-service', () => ({ bountyRequestService: {} }));
jest.mock('../../../lib/services/cancellation-service', () => ({ cancellationService: {} }));
jest.mock('../../../lib/services/dispute-service', () => ({ disputeService: {} }));

import { useJobConversation } from '../../../hooks/useJobWorkspaceData';

const HIRED = '2026-11-20T10:00:00Z';
const msg = (senderId: string, text: string, createdAt: string) => ({ senderId, text, createdAt });
const WELCOME = msg('poster', buildHireWelcomeMessage('Garage'), '2026-11-20T10:00:03Z');

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
  expect(c.hasMessages).toBe(false);
  expect(c.lastFromOther).toBeNull();
});

it('a question asked before the hire is not agreeing a time', async () => {
  expect((await load([msg('poster', 'Do you have a van?', '2026-11-19T10:00:00Z'), WELCOME])).hasMessages).toBe(false);
});

it('a message after the hire is, and an unanswered one is tracked', async () => {
  const sent = msg('poster', 'Saturday?', '2026-11-20T11:00:00Z');
  const c = await load([WELCOME, sent]);
  expect(c.hasMessages).toBe(true);
  expect(c.awaitingReplySince).toBe(sent.createdAt);
  expect((await load([WELCOME, sent, msg('ada', 'Yes', '2026-11-20T12:00:00Z')])).awaitingReplySince).toBeNull();
});

it('a failed read never sends the job back a step', async () => {
  mockConversations.mockRejectedValue(new Error('offline'));
  const { result } = renderHook(() => useJobConversation({ viewerId: 'poster', otherId: 'ada', bountyId: 'b' }));
  await waitFor(() => expect(result.current.loaded).toBe(true));
  expect(result.current.hasMessages).toBe(true);
});
