// supabase-js hands back the EXISTING channel when .channel(topic) is called
// for a topic already registered on the client, and removeChannel() finishes
// asynchronously. So any subscription that is torn down and rebuilt under the
// same topic -- an effect re-running because its deps changed, a remount, or
// two components watching the same row -- can be given the previous,
// already-subscribed channel, and its first .on('postgres_changes', ...) throws
// "cannot add `postgres_changes` callbacks for realtime:<topic> after
// `subscribe()`" (#840, #872). Even when the throw is caught, the caller ends up
// sharing a channel that the other subscriber's cleanup will remove.
//
// A fresh suffix per call gives every subscription its own channel. The topic
// is a client-side label only; postgres_changes routing uses the filter, so
// the suffix changes nothing on the server.
let topicCounter = 0;

export function uniqueRealtimeTopic(base: string): string {
  topicCounter += 1;
  return `${base}:${topicCounter}`;
}
