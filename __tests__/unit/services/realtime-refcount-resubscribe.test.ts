/**
 * The reference-counted realtime services (conversations, messages,
 * notifications, follows) share one channel between concurrent subscribers,
 * keyed by a fixed name. When the last listener leaves, removeChannel() runs
 * asynchronously and the channel stays registered on the client until the
 * server acknowledges the leave. A subscriber arriving in that window -- e.g.
 * leaving a chat and reopening it straight away -- used to call
 * supabase.channel(sameName), get the dying, already-subscribed channel back,
 * and throw "cannot add `postgres_changes` callbacks ... after `subscribe()`"
 * (same class of bug as #840 / #872).
 */

// Behaves like the real client: .channel(topic) returns the registered channel
// for a known topic, and .on() throws once that channel is subscribed.
// removeChannel() never drops the topic here, standing in for the async
// removal still in flight.
jest.mock('../../../lib/supabase', () => {
  const registry = new Map<string, any>();
  const makeChannel = (topic: string) => {
    const channel: any = {
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

import { subscribeToFollowChanges } from '../../../lib/services/follow-realtime';
import { subscribeToNotifications } from '../../../lib/services/notification-realtime';
import {
  subscribeToConversations,
  subscribeToMessages,
} from '../../../lib/services/supabase-messaging';
import { supabase } from '../../../lib/supabase';

const cases: [string, (listener: () => void) => () => void][] = [
  ['subscribeToConversations', l => subscribeToConversations('user-1', l)],
  ['subscribeToMessages', l => subscribeToMessages('conv-1', l)],
  ['subscribeToNotifications', l => subscribeToNotifications('user-1', l)],
  ['subscribeToFollowChanges', l => subscribeToFollowChanges('user-1', l)],
];

describe.each(cases)('%s', (_name, subscribe) => {
  const channelMock = supabase.channel as jest.Mock;

  beforeEach(() => {
    channelMock.mockClear();
  });

  it('shares one channel between concurrent subscribers', () => {
    const offA = subscribe(jest.fn());
    const offB = subscribe(jest.fn());
    expect(channelMock).toHaveBeenCalledTimes(1);
    offA();
    offB();
  });

  it('resubscribes on a fresh channel while the previous removal is still in flight', () => {
    const off = subscribe(jest.fn());
    off();
    expect(supabase.removeChannel).toHaveBeenCalled();

    let offAgain: (() => void) | undefined;
    expect(() => {
      offAgain = subscribe(jest.fn());
    }).not.toThrow();

    const [first, second] = channelMock.mock.results.map(r => r.value);
    expect(channelMock.mock.calls[1][0]).not.toEqual(channelMock.mock.calls[0][0]);
    expect(second).not.toBe(first);
    expect(second.subscribe).toHaveBeenCalledTimes(1);
    offAgain?.();
  });
});
