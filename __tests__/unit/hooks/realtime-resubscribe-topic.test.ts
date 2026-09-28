/**
 * Regression test for "cannot add `postgres_changes` callbacks for
 * realtime:inbox-requests:<user> after `subscribe()`" (#872).
 *
 * The inbox, postings and status-filter effects rebuild their realtime channel
 * whenever the set of bounty ids they watch changes. supabase-js returns the
 * SAME channel object for a topic that is still registered, and the cleanup's
 * removeChannel() resolves asynchronously, so a rebuild under a fixed per-user
 * topic got the previous, already-subscribed channel back and .on() threw.
 *
 * useBountyStatusFilters is the cheapest of those effects to drive in a test;
 * the screens use the same uniqueRealtimeTopic() call.
 */
import { renderHook, waitFor } from '@testing-library/react-native';

jest.mock('../../../lib/services/completion-service', () => ({
  completionService: {
    getLatestSubmissionsForBounties: jest.fn().mockResolvedValue(new Map()),
  },
}));

// Behaves like the real client in the two ways that combine into the crash:
// .channel(topic) returns the registered channel for a known topic, and .on()
// throws once that channel is subscribed. removeChannel() never drops the
// topic within the test, standing in for the async removal still in flight.
jest.mock('../../../lib/supabase', () => {
  const registry = new Map<string, any>();
  const makeChannel = (topic: string) => {
    const channel: any = {
      _topic: topic,
      _subscribed: false,
      on: jest.fn(() => {
        if (channel._subscribed) {
          throw new Error(
            `cannot add \`postgres_changes\` callbacks for realtime:${topic} after \`subscribe()\`.`
          );
        }
        return channel;
      }),
      subscribe: jest.fn(() => {
        channel._subscribed = true;
        return channel;
      }),
    };
    return channel;
  };
  const channel = jest.fn((topic: string) => {
    if (!registry.has(topic)) registry.set(topic, makeChannel(topic));
    return registry.get(topic);
  });
  return { supabase: { channel, removeChannel: jest.fn(() => Promise.resolve('ok')) } };
});

import { useBountyStatusFilters } from '../../../hooks/useBountyStatusFilters';
import { supabase } from '../../../lib/supabase';

const inProgress = (id: string) => ({ id, status: 'in_progress', title: id }) as any;

const args = (myBounties: any[]) => ({
  currentUserId: 'user-1',
  myBounties,
  inProgressBounties: [],
  hunterRequests: [],
  statusFilterInProgress: 'all' as const,
  statusFilterMyPostings: 'all' as const,
});

describe('realtime channel rebuild after a dependency change', () => {
  it('subscribes a fresh channel instead of reusing the already-subscribed one', async () => {
    const channelMock = supabase.channel as jest.Mock;
    const { rerender } = renderHook((props: any[]) => useBountyStatusFilters(args(props)), {
      initialProps: [inProgress('a')],
    });
    await waitFor(() => expect(channelMock).toHaveBeenCalledTimes(1));

    // A second bounty goes in progress: same user, different id set, so the
    // effect tears the channel down and rebuilds it straight away.
    rerender([inProgress('a'), inProgress('b')]);
    await waitFor(() => expect(channelMock).toHaveBeenCalledTimes(2));

    const [first, second] = channelMock.mock.results.map(r => r.value);
    expect(channelMock.mock.calls[1][0]).not.toEqual(channelMock.mock.calls[0][0]);
    expect(second).not.toBe(first);
    expect(second.subscribe).toHaveBeenCalledTimes(1);
    expect(supabase.removeChannel).toHaveBeenCalledWith(first);
  });
});
