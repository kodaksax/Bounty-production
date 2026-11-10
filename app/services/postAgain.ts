import type { BountyDraft } from 'app/hooks/useBountyDraft';
import { supabase } from 'lib/supabase';

/**
 * "Post again": a composer draft filled in from one of the poster's past
 * bounties, so a repeat job (the same trash run, the same lawn) is reviewed
 * and posted instead of retyped. Works from any status, cancelled and
 * completed included.
 *
 * What carries over is what describes the job: title, description, category,
 * work type, amount (and for-honor), and where it is. The address comes from
 * get_bounty_exact_location(), because bounties.location only holds the public
 * "City, ST" label; that RPC hands the exact address to the poster only.
 *
 * What does NOT carry over is anything tied to the old posting's life: its
 * schedule dates, status, attachments and applicants. The trust tier resets to
 * standard; the composer's Compensation step recommends one again from the
 * text, the same as for any new post.
 */

export type PostAgainErrorCode = 'not_signed_in' | 'not_found' | 'not_owner' | 'load_failed';

export class PostAgainError extends Error {
  readonly code: PostAgainErrorCode;
  constructor(code: PostAgainErrorCode, message: string) {
    super(message);
    this.name = 'PostAgainError';
    this.code = code;
  }
}

/** Columns read from the source bounty. Nothing about its schedule, status or applicants. */
const SOURCE_COLUMNS =
  'id, poster_id, user_id, title, description, category, work_type, amount, is_for_honor, zip_code, neighborhood';

export interface PostAgainSourceRow {
  id: string;
  poster_id?: string | null;
  user_id?: string | null;
  title?: string | null;
  description?: string | null;
  category?: string | null;
  work_type?: string | null;
  amount?: number | string | null;
  is_for_honor?: boolean | null;
  zip_code?: string | null;
  neighborhood?: string | null;
}

export interface PostAgainExactLocation {
  location: string | null;
  latitude: number | null;
  longitude: number | null;
  unit: string | null;
}

/** The poster of a bounty row, by the same rule as get_bounty_exact_location(): COALESCE(poster_id, user_id). */
export function posterIdOf(row: Pick<PostAgainSourceRow, 'poster_id' | 'user_id'>): string | null {
  const id = row.poster_id ?? row.user_id;
  return id ? String(id) : null;
}

/**
 * Pure mapping from a bounty row (+ its exact location) to a fresh draft.
 * Every field the composer has is set explicitly, so nothing from an older
 * draft or the old bounty's life leaks in.
 */
export function draftFromBounty(
  row: PostAgainSourceRow,
  exact: PostAgainExactLocation | null
): BountyDraft {
  const workType: BountyDraft['workType'] = row.work_type === 'online' ? 'online' : 'in_person';
  const isForHonor = Boolean(row.is_for_honor);
  const amount = Number(row.amount);
  const inPerson = workType === 'in_person';
  const hasCoords = !!exact && exact.latitude != null && exact.longitude != null;

  return {
    title: row.title ?? '',
    description: row.description ?? '',
    category: row.category ?? '',
    workType,
    amount: isForHonor || !Number.isFinite(amount) ? 0 : amount,
    isForHonor,

    // Where. Only an in-person job has an address. Without an exact address
    // (a bounty older than bounty_private_locations), the location stays
    // empty rather than taking the public "City, ST" label: StepWhere would
    // geocode that label to the middle of town and publish the job there.
    location: inPerson ? exact?.location ?? '' : '',
    latitude: inPerson && hasCoords ? (exact!.latitude as number) : undefined,
    longitude: inPerson && hasCoords ? (exact!.longitude as number) : undefined,
    unit: inPerson ? exact?.unit || undefined : undefined,
    zipCode: inPerson ? row.zip_code ?? '' : '',
    // The public label StepWhere sets beside the pin; the row's copy is the
    // already-sanitized one, so it is safe to carry.
    neighborhood: inPerson && hasCoords ? row.neighborhood || undefined : undefined,

    // Not copied: the old posting's schedule, files, and legacy free text.
    timeline: '',
    skills: '',
    attachments: [],
    scheduleType: undefined,
    startDate: undefined,
    endDate: undefined,
    latestArrivalTime: undefined,
    durationMinutes: undefined,
    conditionalEndNote: undefined,
    requirements: undefined,

    // Reset: the trust requirement is chosen again for the new post.
    trustTier: 'standard',
    requiresIdVerified: false,

    republishedFrom: String(row.id),
  };
}

async function currentUserId(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.user?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Builds a "Post again" draft from `bountyId`. Poster only: it throws
 * PostAgainError('not_owner') for anyone else's bounty (including the hunter
 * who did the job), and 'not_found' when the row can't be read at all.
 * `userId` defaults to the signed-in user.
 */
export async function buildDraftFromBounty(
  bountyId: string,
  userId?: string | null
): Promise<BountyDraft> {
  const viewerId = userId ?? (await currentUserId());
  if (!viewerId) {
    throw new PostAgainError('not_signed_in', 'Sign in to post this again.');
  }

  const { data, error } = await supabase
    .from('bounties')
    .select(SOURCE_COLUMNS)
    .eq('id', bountyId)
    .maybeSingle();
  if (error) {
    throw new PostAgainError('load_failed', "We couldn't load that bounty. Check your connection and try again.");
  }
  const row = data as PostAgainSourceRow | null;
  if (!row) {
    throw new PostAgainError('not_found', 'That bounty no longer exists.');
  }
  // Checked here, before the address is asked for: the RPC also answers the
  // accepted hunter while a job is live, and Post again is for the poster.
  if (posterIdOf(row) !== String(viewerId)) {
    throw new PostAgainError('not_owner', 'You can only post your own bounties again.');
  }

  let exact: PostAgainExactLocation | null = null;
  if (row.work_type !== 'online') {
    const rpc = await supabase.rpc('get_bounty_exact_location', { p_bounty_id: bountyId });
    if (rpc.error) {
      // Failing beats a draft with a silently missing address.
      throw new PostAgainError('load_failed', "We couldn't load that bounty's address. Try again.");
    }
    const loc = (Array.isArray(rpc.data) ? rpc.data[0] : rpc.data) as PostAgainExactLocation | undefined;
    exact = loc ?? null;
  }

  return draftFromBounty(row, exact);
}
