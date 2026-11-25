/**
 * useJobConversation: what counts as the two of them having talked since the
 * hire. The app sends its own message in the poster's name when someone is
 * chosen; that one never counts.
 */
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { buildHireWelcomeMessage, isCoordinationMessage } from '../../../lib/my-jobs/hire-message';

const mockConversations = jest.fn();
const mockMessages = jest.fn();
jest.mock('../../../lib/services/supabase-messaging', () => ({
  fetchConversations: (...a: unknown[]) => mockConversations(...a),
}));
jest.mock('../../../lib/services/message-service', () => ({
  messageService: { getMessagesForConversations: (...a: unknown[]) => mockMessages(...a) },
}));
jest.mock('../../../lib/services/bounty-request-service', () => ({ bountyRequestService: {} }));
jest.mock('../../../lib/services/cancellation-service', () => ({ cancellationService: {} }));
jest.mock('../../../lib/services/dispute-service', () => ({ disputeService: {} }));

import { useJobConversation } from '../../../hooks/useJobWorkspaceData';

const HIRED = '2026-11-20T10:00:00Z';
const msg = (senderId: string, text: string, createdAt: string, conversationId = 'c') => ({ senderId, text, createdAt, conversationId });
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

it('a failed read leaves its block out, and claims no messages', async () => {
  mockConversations.mockRejectedValue(new Error('offline'));
  const { result } = renderHook(() => useJobConversation({ viewerId: 'poster', otherId: 'ada', bountyId: 'b' }));
  await waitFor(() => expect(result.current.loaded).toBe(true));
  expect(result.current.firstTalk).toBeNull();
  // Not "no messages": the page must not call the helper quiet from this.
  expect(result.current.messagesKnown).toBe(false);
  // Asked to report failure instead of returning a cached list.
  expect(mockConversations).toHaveBeenCalledWith('poster', { throwOnError: true });
});

it('a failed message read claims no messages either', async () => {
  mockConversations.mockResolvedValue([{ id: 'c', bountyId: 'b', isGroup: false, participantIds: ['poster', 'ada'] }]);
  mockMessages.mockRejectedValue(new Error('offline'));
  const { result } = renderHook(() => useJobConversation({ viewerId: 'poster', otherId: 'ada', bountyId: 'b', since: HIRED }));
  await waitFor(() => expect(result.current.loaded).toBe(true));
  expect(result.current.messagesKnown).toBe(false);
  expect(result.current.messages).toEqual([]);
});

it('a failed refresh keeps the last answer it confirmed', async () => {
  const reply = msg('ada', 'On my way', '2026-11-21T09:00:00Z');
  mockConversations.mockResolvedValue([{ id: 'c', bountyId: 'b', isGroup: false, participantIds: ['poster', 'ada'] }]);
  mockMessages.mockResolvedValue([reply]);
  const { result } = renderHook(() => useJobConversation({ viewerId: 'poster', otherId: 'ada', bountyId: 'b', since: HIRED }));
  await waitFor(() => expect(result.current.messagesKnown).toBe(true));
  mockConversations.mockRejectedValue(new Error('offline'));
  await act(async () => result.current.reload());
  await waitFor(() => expect(mockConversations).toHaveBeenCalledTimes(2));
  expect(result.current.loaded).toBe(true);
  expect(result.current.messagesKnown).toBe(true);
  expect(result.current.messages.map((m) => m.text)).toEqual(['On my way']);
});

it('reads a hire time without a zone as UTC, so a message right after the hire counts', () => {
  const sent = { text: 'Saturday?', createdAt: '2026-11-20T10:05:00+00:00' };
  expect(isCoordinationMessage(sent, '2026-11-20T10:00:00')).toBe(true);
  expect(isCoordinationMessage(sent, '2026-11-20T10:06:00')).toBe(false);
  // The same instant written the way every server row writes it must not depend on this machine's zone.
  expect(isCoordinationMessage({ text: 'x', createdAt: '2026-11-20T10:00:00Z' }, '2026-11-20T10:00:00')).toBe(true);
});

it('another job’s conversation never answers for this job’s last message, reply or first word', async () => {
  mockConversations.mockResolvedValue([
    { id: 'd', bountyId: 'old', isGroup: false, participantIds: ['poster', 'ada'] },
  ]);
  mockMessages.mockResolvedValue([msg('ada', 'Saturday works', '2026-11-20T12:00:00Z', 'd')]);
  const { result } = renderHook(() => useJobConversation({ viewerId: 'poster', otherId: 'ada', bountyId: 'b', since: HIRED }));
  await waitFor(() => expect(result.current.loaded).toBe(true));
  expect(result.current.conversationId).toBeNull();
  expect(result.current.firstTalk).toBeNull();
  expect(result.current.lastFromOther).toBeNull();
});

it('a reply that landed in the pair’s older conversation still counts for the phase', async () => {
  // A repeat hire: the direct-message RPC reuses the pair's first conversation.
  mockConversations.mockResolvedValue([
    { id: 'c', bountyId: 'b', isGroup: false, participantIds: ['poster', 'ada'] },
    { id: 'd', bountyId: 'old', isGroup: false, participantIds: ['poster', 'ada'] },
    { id: 'x', bountyId: 'b', isGroup: false, participantIds: ['poster', 'someone-else'] },
  ]);
  mockMessages.mockResolvedValue([WELCOME, msg('ada', 'Saturday works', '2026-11-20T12:00:00Z', 'd')]);
  const { result } = renderHook(() => useJobConversation({ viewerId: 'poster', otherId: 'ada', bountyId: 'b', since: HIRED }));
  await waitFor(() => expect(result.current.loaded).toBe(true));
  // One read for every conversation the two share, and only theirs.
  expect(mockMessages).toHaveBeenCalledWith(['c', 'd']);
  expect(result.current.messagesKnown).toBe(true);
  expect(result.current.messages.map((m) => m.text)).toEqual(['Saturday works']);
  // The job's own blocks still come from its own thread.
  expect(result.current.conversationId).toBe('c');
  expect(result.current.lastFromOther).toBeNull();
});

describe('E2E-04: server event cards are not the helper talking', () => {
  const applied = { senderId: 'ada', text: 'Applied to this bounty.', createdAt: '2026-11-20T12:00:00Z', messageType: 'system', conversationId: 'c' };
  const submitted = { senderId: 'ada', text: 'Submitted the work for review.', createdAt: '2026-11-21T12:00:00Z', messageType: 'system', conversationId: 'c' };

  it('a system card is never quoted as their last message, never a reply, and never in `messages`', async () => {
    const sent = msg('poster', 'Saturday?', '2026-11-20T11:00:00Z');
    const c = await load([WELCOME, sent, applied, submitted]);
    expect(c.lastFromOther).toBeNull();
    expect(c.awaitingReplySince).toBe(sent.createdAt);
    expect(c.messages.map((m) => m.text)).toEqual(['Saturday?']);
  });

  it("the helper's own text is in `messages`, with its sender and type", async () => {
    const c = await load([applied, { ...msg('ada', 'On my way Saturday', '2026-11-21T09:00:00Z'), messageType: 'text' }]);
    expect(c.messages).toEqual([{ senderId: 'ada', createdAt: '2026-11-21T09:00:00Z', text: 'On my way Saturday', messageType: 'text' }]);
    expect(c.lastFromOther?.text).toBe('On my way Saturday');
  });

  it('is not "loaded" for a helper it has not read yet (no phase from zero messages)', async () => {
    mockConversations.mockResolvedValue([{ id: 'c', bountyId: 'b', isGroup: false, participantIds: ['poster', 'ada'] }]);
    mockMessages.mockResolvedValue([]);
    const { result, rerender } = renderHook(
      ({ other }: { other: string | null }) => useJobConversation({ viewerId: 'poster', otherId: other, bountyId: 'b', since: HIRED }),
      { initialProps: { other: null as string | null } }
    );
    await waitFor(() => expect(result.current.loaded).toBe(true));
    rerender({ other: 'ada' });
    // The same render the helper becomes known in must not claim loaded.
    expect(result.current.loaded).toBe(false);
    await waitFor(() => expect(result.current.loaded).toBe(true));
  });
});
