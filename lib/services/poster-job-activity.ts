/**
 * What has actually happened on one job, as the poster is allowed to see it.
 *
 * The job page uses this for two things: the "What's happened" timeline, and
 * telling the poster whether the person they chose has been in touch. Both
 * must only ever show events that really occurred, so every field here comes
 * from a row the poster can already read under RLS:
 *
 *   - offers        bounty_requests (created_at; accepted_at is stamped by the
 *                   B-06 trigger on every accept, for every writer)
 *   - messages      messages in this job's conversations. RLS limits the
 *                   conversations to ones the poster is a participant in, so
 *                   this is only ever the poster's own chat about this job.
 *
 * It reads only. A failed read degrades to `null` fields (the page then shows
 * nothing rather than a guess), never to "no messages", which would wrongly
 * tell the poster the helper has gone quiet.
 */
import { isSupabaseConfigured, supabase } from '../supabase';

export interface PosterJobActivity {
  /** Every offer ever made on this job (any status), oldest first. */
  offers: { createdAt: string; status: string; hunterId: string }[] | null;
  /** When the chosen person's offer was accepted. */
  hiredAt: string | null;
  /** Latest message the chosen person sent about this job. Null when unknown. */
  lastHelperMessageAt: string | null;
  /** Latest message the poster sent about this job. */
  lastPosterMessageAt: string | null;
  /**
   * True when the message read succeeded, so `lastHelperMessageAt === null`
   * really means "they haven't written yet" rather than "we couldn't check".
   */
  messagesKnown: boolean;
}

export const EMPTY_POSTER_JOB_ACTIVITY: PosterJobActivity = {
  offers: null,
  hiredAt: null,
  lastHelperMessageAt: null,
  lastPosterMessageAt: null,
  messagesKnown: false,
};

export async function getPosterJobActivity(args: {
  bountyId: string;
  posterId: string;
  helperId: string | null;
}): Promise<PosterJobActivity> {
  const { bountyId, posterId, helperId } = args;
  if (!isSupabaseConfigured || !bountyId) return EMPTY_POSTER_JOB_ACTIVITY;

  const [offersResult, messagesResult] = await Promise.allSettled([
    readOffers(bountyId),
    helperId ? readMessageTimes(bountyId, posterId, helperId) : Promise.resolve(null),
  ]);

  const offers = offersResult.status === 'fulfilled' ? offersResult.value : null;
  const accepted =
    offers && helperId ? offers.find(o => o.status === 'accepted' && o.hunterId === helperId) : undefined;

  const messages = messagesResult.status === 'fulfilled' ? messagesResult.value : null;

  return {
    offers: offers ? offers.map(({ createdAt, status, hunterId }) => ({ createdAt, status, hunterId })) : null,
    hiredAt: accepted?.acceptedAt ?? null,
    lastHelperMessageAt: messages?.lastHelper ?? null,
    lastPosterMessageAt: messages?.lastPoster ?? null,
    messagesKnown: !!messages,
  };
}

/**
 * Pending offers per job, for the poster's own jobs on Home. Throws on a
 * failed read so the caller keeps its last known counts instead of showing 0.
 */
export async function getPendingOfferCounts(bountyIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (!isSupabaseConfigured || bountyIds.length === 0) return counts;
  const { data, error } = await supabase
    .from('bounty_requests')
    .select('bounty_id')
    .in('bounty_id', bountyIds)
    .eq('status', 'pending');
  if (error) throw error;
  for (const row of (data ?? []) as { bounty_id?: string | null }[]) {
    if (!row?.bounty_id) continue;
    const id = String(row.bounty_id);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

async function readOffers(
  bountyId: string
): Promise<{ createdAt: string; status: string; hunterId: string; acceptedAt: string | null }[]> {
  const { data, error } = await supabase
    .from('bounty_requests')
    .select('hunter_id, status, created_at, accepted_at')
    .eq('bounty_id', bountyId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? [])
    .filter((r: any) => !!r?.created_at)
    .map((r: any) => ({
      createdAt: asUtcIso(r.created_at),
      status: String(r.status ?? ''),
      hunterId: String(r.hunter_id ?? ''),
      acceptedAt: r.accepted_at ? asUtcIso(r.accepted_at) : null,
    }));
}

async function readMessageTimes(
  bountyId: string,
  posterId: string,
  helperId: string
): Promise<{ lastHelper: string | null; lastPoster: string | null } | null> {
  const { data: conversations, error: convError } = await supabase
    .from('conversations')
    .select('id')
    .eq('bounty_id', bountyId);
  if (convError) throw convError;
  const ids = (conversations ?? []).map((c: any) => String(c.id)).filter(Boolean);
  if (ids.length === 0) return null;

  const [helper, poster] = await Promise.all([
    latestFrom(ids, helperId),
    latestFrom(ids, posterId),
  ]);
  return { lastHelper: helper, lastPoster: poster };
}

async function latestFrom(conversationIds: string[], senderId: string): Promise<string | null> {
  // Only messages a person typed. Applying posts an automatic "Applied to this
  // bounty." system message attributed to the applicant; counting that as a
  // reply would hide a helper who has never actually written.
  const { data, error } = await supabase
    .from('messages')
    .select('created_at')
    .in('conversation_id', conversationIds)
    .eq('sender_id', senderId)
    .eq('message_type', 'text')
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : null;
  return row?.created_at ? asUtcIso(row.created_at) : null;
}

/**
 * Some lifecycle columns (bounty_requests.accepted_at) are `timestamp without
 * time zone` holding UTC, so the API returns them with no offset, and
 * `new Date("2026-11-12T20:20:17")` would read them as the PHONE's local time:
 * "chosen 4 days ago" became "3 days ago" in California. A value with no zone
 * designator is treated as the UTC it is.
 */
export function asUtcIso(value: unknown): string {
  const s = String(value);
  return /(Z|[+-]\d{2}:?\d{2})$/i.test(s) ? s : `${s.replace(' ', 'T')}Z`;
}
