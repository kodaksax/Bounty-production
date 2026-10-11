// Per-email reply addresses: reply+<token>@<EMAIL_REPLY_DOMAIN>.
//
// The token is an opaque random id for a row in public.email_reply_contexts
// (poster, bounty, applicant, expiry). It lets email-inbound match a reply to
// the bounty it is about WITHOUT trusting anything the sender wrote — a From
// header is trivially forged and quoted text is unreliable.
//
// A token grants nothing on its own. email-inbound never accepts or declines
// from a reply: it opens a support case and emails the poster's ACCOUNT
// address (never the reply's From) a link to confirm on the website, where
// they must be signed in. A guessed or forwarded token can at most cause that
// one confirmation email to the real owner.
//
// Dependency-free (the DB client is passed in) so it is unit-tested directly.

/** How long a reply to a notification email is matched to its context. */
export const REPLY_CONTEXT_TTL_DAYS = 14

const TOKEN_RE = /^[a-z2-7]{26}$/

/**
 * EMAIL_REPLY_DOMAIN is a bare host like `reply.bountyfinder.net`. Anything
 * else (unset, an address, a URL) disables per-email reply addresses, and
 * replies keep going to the support inbox as before.
 */
export function resolveReplyDomain(configured: string | null | undefined): string | null {
  const raw = (configured ?? '').trim().toLowerCase()
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(raw) ? raw : null
}

/** 130 bits of randomness, base32 (lowercase) so it survives any mail client. */
export function generateReplyToken(random: (n: number) => Uint8Array = defaultRandom): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567'
  const bytes = random(26)
  let out = ''
  for (let i = 0; i < 26; i++) out += alphabet[bytes[i] & 31]
  return out
}

function defaultRandom(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n))
}

export function replyAddressFor(token: string, domain: string): string {
  return `reply+${token}@${domain}`
}

/**
 * Pulls the token out of a recipient list. Accepts bare addresses and display
 * forms (`Bounty <reply+abc@reply.example>`), matches the domain exactly, and
 * ignores everything else — a reply cc'ing other people still resolves.
 */
export function parseReplyToken(recipients: unknown, domain: string | null): string | null {
  if (!domain) return null
  const list = Array.isArray(recipients) ? recipients : [recipients]
  for (const entry of list) {
    if (typeof entry !== 'string') continue
    const address = (entry.match(/<([^>]+)>/)?.[1] ?? entry).trim().toLowerCase()
    const m = address.match(/^reply\+([a-z2-7]+)@(.+)$/)
    if (m && m[2] === domain && TOKEN_RE.test(m[1])) return m[1]
  }
  return null
}

export interface ReplyContextInput {
  posterId: string
  bountyId: string
  requestId: string | null
  notificationType: string
}

// Minimal structural type: anything with supabase-js's from().insert().
type InsertClient = {
  from: (table: string) => { insert: (row: Record<string, unknown>) => PromiseLike<{ error: unknown }> }
}

/** Stores a context and returns its token, or null if it could not be stored. */
export async function createReplyContext(
  client: InsertClient,
  input: ReplyContextInput,
  now: Date = new Date()
): Promise<string | null> {
  const token = generateReplyToken()
  try {
    const { error } = await client.from('email_reply_contexts').insert({
      token,
      poster_id: input.posterId,
      bounty_id: input.bountyId,
      request_id: input.requestId,
      notification_type: input.notificationType,
      expires_at: new Date(now.getTime() + REPLY_CONTEXT_TTL_DAYS * 86_400_000).toISOString(),
    })
    if (error) {
      console.error('[reply-context] could not store reply context (email still sent)', error)
      return null
    }
    return token
  } catch (e) {
    console.error('[reply-context] could not store reply context (email still sent)', e)
    return null
  }
}
