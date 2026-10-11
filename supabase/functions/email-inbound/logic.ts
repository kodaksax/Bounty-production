// Pure logic for email-inbound. No imports; unit-tested in
// __tests__/unit/email-inbound-logic.test.ts.
//
// THE RULE: a reply never accepts, declines or pays anything. Email text is
// unauthenticated (From is forgeable, quoted text is unreliable, a forwarded
// thread can be answered by anyone). Intent only chooses the WORDS of the
// acknowledgement, which always asks the account owner to confirm on the
// website while signed in.

// ── Svix / Resend webhook signature ───────────────────────────────────────

export const SIGNATURE_TOLERANCE_SECONDS = 5 * 60

function base64ToBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out.buffer as ArrayBuffer
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/**
 * Verifies a Svix-signed webhook (the scheme Resend uses): HMAC-SHA256 over
 * `${svix-id}.${svix-timestamp}.${rawBody}` keyed with the base64 part of the
 * `whsec_` secret, compared against every `v1,<sig>` entry in svix-signature.
 * Fails closed on any missing piece or a timestamp outside the tolerance.
 */
export async function verifySvixSignature(
  secret: string | null | undefined,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  rawBody: string,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): Promise<boolean> {
  if (!secret || !headers.id || !headers.timestamp || !headers.signature) return false
  const ts = Number(headers.timestamp)
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > SIGNATURE_TOLERANCE_SECONDS) return false

  let keyBytes: ArrayBuffer
  try {
    keyBytes = base64ToBuffer(secret.startsWith('whsec_') ? secret.slice(6) : secret)
  } catch {
    return false
  }
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${headers.id}.${headers.timestamp}.${rawBody}`))
  const expected = bytesToBase64(new Uint8Array(mac))

  return headers.signature
    .split(' ')
    .map((part) => part.trim())
    .filter((part) => part.startsWith('v1,'))
    .some((part) => constantTimeEqual(part.slice(3), expected))
}

// ── Reading a reply ───────────────────────────────────────────────────────

/**
 * The poster's own words: everything above the quoted original. Stops at the
 * first quoted line or a client's "On <date>, <name> wrote:" / "From:" /
 * "-----Original Message-----" separator.
 */
export function extractReplyText(text: string | null | undefined): string {
  if (!text) return ''
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n')
  const kept: string[] = []
  for (const line of lines) {
    const t = line.trim()
    if (t.startsWith('>')) break
    if (/^on .+wrote:?$/i.test(t)) break
    if (/^-{2,}\s*original message\s*-{2,}$/i.test(t)) break
    if (/^from:\s/i.test(t) && kept.length > 0) break
    if (/^sent from my /i.test(t)) continue
    kept.push(line)
  }
  return kept.join('\n').trim().slice(0, 2000)
}

export type ReplyIntent = 'accept' | 'decline' | 'other'

const ACCEPT_RE = /^(yes|yep|yeah|ok|okay|accept(ed)?|approve(d)?|i accept|go ahead|sounds good|hire (them|him|her))\b/i
const DECLINE_RE = /^(no|nope|decline(d)?|reject(ed)?|not interested|no thanks|pass)\b/i
const NEGATION_RE = /\b(not|don'?t|do not|never|cancel|stop|wait)\b/i

/**
 * Deliberately conservative: only a short first line that plainly says yes or
 * no is read as an intent. Anything longer, negated or mixed is 'other' and
 * gets the neutral acknowledgement — misreading "don't accept" as accept
 * would at worst send the wrong wording, but it is still worth avoiding.
 */
export function classifyReplyIntent(replyText: string): ReplyIntent {
  const firstLine = replyText.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? ''
  if (!firstLine || firstLine.length > 80) return 'other'
  // "No problem, go ahead" / "No worries" are not a no.
  if (/^no (problem|worries|prob)\b/i.test(firstLine)) return 'other'
  const isAccept = ACCEPT_RE.test(firstLine)
  const isDecline = DECLINE_RE.test(firstLine)
  if (isAccept && !isDecline && !NEGATION_RE.test(firstLine)) return 'accept'
  if (isDecline && !isAccept) return 'decline'
  return 'other'
}

/** Bare, lowercased address from `Name <a@b.c>` or `a@b.c`. */
export function bareEmail(value: unknown): string {
  if (typeof value !== 'string') return ''
  return (value.match(/<([^>]+)>/)?.[1] ?? value).trim().toLowerCase()
}

// ── The acknowledgement ───────────────────────────────────────────────────

export function buildReplyAck(intent: ReplyIntent, bountyTitle: string | null): { title: string; body: string; ctaLabel: string } {
  const t = (bountyTitle ?? '').trim() || 'your bounty'
  const safety =
    'To keep your bounty and your money safe, we never act on an email reply alone — please tap the button and confirm while signed in. It only takes a moment.'
  switch (intent) {
    case 'accept':
      return {
        title: `One tap to confirm your choice for "${t}"`,
        body: `We got your reply saying you’d like to accept this hunter. ${safety} A person on our team has seen your message too, in case you need help.`,
        ctaLabel: 'Confirm and accept',
      }
    case 'decline':
      return {
        title: `One tap to confirm for "${t}"`,
        body: `We got your reply saying you’d like to decline. ${safety} A person on our team has seen your message too.`,
        ctaLabel: 'Review and decline',
      }
    default:
      return {
        title: `We got your message about "${t}"`,
        body: 'Thanks for writing. A real person on our team will reply soon. If you were trying to accept or decline someone, you can do it right now with the button below.',
        ctaLabel: 'See your bounty',
      }
  }
}

/** One acknowledgement per context per window, so a reply loop can't spam. */
export const ACK_COOLDOWN_MS = 10 * 60 * 1000

export function shouldSendAck(lastReplyAt: string | null | undefined, now: Date = new Date()): boolean {
  if (!lastReplyAt) return true
  const last = Date.parse(lastReplyAt)
  return !Number.isFinite(last) || now.getTime() - last >= ACK_COOLDOWN_MS
}
