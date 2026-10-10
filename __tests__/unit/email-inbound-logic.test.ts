import { createHmac } from 'crypto'
import {
  bareEmail,
  buildReplyAck,
  classifyReplyIntent,
  extractReplyText,
  shouldSendAck,
  verifySvixSignature,
} from '../../supabase/functions/email-inbound/logic'

const SECRET_B64 = Buffer.from('test-signing-secret-32-bytes-long!!').toString('base64')
const SECRET = `whsec_${SECRET_B64}`

function sign(id: string, ts: string, body: string, secretB64 = SECRET_B64): string {
  return createHmac('sha256', Buffer.from(secretB64, 'base64')).update(`${id}.${ts}.${body}`).digest('base64')
}

describe('verifySvixSignature — replies are only processed when Resend signed them', () => {
  const body = JSON.stringify({ type: 'email.received', data: { email_id: 'e1' } })
  const now = 1_790_000_000
  const ts = String(now)

  test('accepts a valid signature', async () => {
    expect(await verifySvixSignature(SECRET, { id: 'msg_1', timestamp: ts, signature: `v1,${sign('msg_1', ts, body)}` }, body, now)).toBe(true)
  })

  test('accepts when one of several signatures matches (secret rotation)', async () => {
    const header = `v1,${sign('msg_1', ts, body, Buffer.from('old').toString('base64'))} v1,${sign('msg_1', ts, body)}`
    expect(await verifySvixSignature(SECRET, { id: 'msg_1', timestamp: ts, signature: header }, body, now)).toBe(true)
  })

  test('rejects a tampered body, a wrong secret, a replayed timestamp, or missing headers', async () => {
    const good = `v1,${sign('msg_1', ts, body)}`
    expect(await verifySvixSignature(SECRET, { id: 'msg_1', timestamp: ts, signature: good }, body + ' ', now)).toBe(false)
    expect(await verifySvixSignature(`whsec_${Buffer.from('nope').toString('base64')}`, { id: 'msg_1', timestamp: ts, signature: good }, body, now)).toBe(false)
    expect(await verifySvixSignature(SECRET, { id: 'msg_1', timestamp: ts, signature: good }, body, now + 3600)).toBe(false)
    expect(await verifySvixSignature(SECRET, { id: null, timestamp: ts, signature: good }, body, now)).toBe(false)
    expect(await verifySvixSignature(undefined, { id: 'msg_1', timestamp: ts, signature: good }, body, now)).toBe(false)
    expect(await verifySvixSignature(SECRET, { id: 'msg_1', timestamp: ts, signature: `v2,${sign('msg_1', ts, body)}` }, body, now)).toBe(false)
  })
})

describe('extractReplyText', () => {
  test('keeps only the poster’s own words above the quoted email', () => {
    const text = 'Accept\n\nSent from my iPhone\n\nOn Tue, Oct 7, 2026 at 9:00 AM Bounty <reply+abc@reply.bountyfinder.net> wrote:\n> Someone applied'
    expect(extractReplyText(text)).toBe('Accept')
  })
  test('stops at quoted lines and Outlook separators', () => {
    expect(extractReplyText('Yes please\n> quoted')).toBe('Yes please')
    expect(extractReplyText('No\r\n-----Original Message-----\r\nFrom: Bounty')).toBe('No')
  })
  test('empty input', () => {
    expect(extractReplyText(null)).toBe('')
  })
})

describe('classifyReplyIntent — conservative', () => {
  test.each([
    ['Accept', 'accept'],
    ['accept', 'accept'],
    ['Yes', 'accept'],
    ['Yes please!', 'accept'],
    ['OK go ahead', 'accept'],
    ['Decline', 'decline'],
    ['No thanks', 'decline'],
    ['Reject', 'decline'],
  ])('%s -> %s', (text, intent) => {
    expect(classifyReplyIntent(text)).toBe(intent)
  })

  test.each([
    ["Don't accept yet", 'other'],
    ['Yes but wait until Friday', 'other'],
    ['No problem, go ahead', 'other'],
    ['Who is this person? Are they insured?', 'other'],
    ['', 'other'],
    ['Accept ' + 'x'.repeat(100), 'other'],
  ])('%s -> %s', (text, intent) => {
    expect(classifyReplyIntent(text)).toBe(intent)
  })
})

describe('buildReplyAck — never claims an action was taken', () => {
  test.each(['accept', 'decline', 'other'] as const)('%s acknowledgement asks for a signed-in confirmation', (intent) => {
    const ack = buildReplyAck(intent, 'Trash removal')
    expect(ack.title).toContain('Trash removal')
    expect(ack.body).not.toMatch(/\b(we|you(’|')ve) (accepted|declined)\b/i)
    expect(ack.body).not.toMatch(/\bapp\b/i)
    if (intent !== 'other') expect(ack.body).toMatch(/never act on an email reply alone/)
  })
})

describe('helpers', () => {
  test('bareEmail', () => {
    expect(bareEmail('Jane <Jane@Example.com>')).toBe('jane@example.com')
    expect(bareEmail(' jane@example.com ')).toBe('jane@example.com')
    expect(bareEmail(undefined)).toBe('')
  })
  test('shouldSendAck rate-limits acknowledgements per reply context', () => {
    const now = new Date('2026-10-08T12:00:00Z')
    expect(shouldSendAck(null, now)).toBe(true)
    expect(shouldSendAck('2026-10-08T11:55:00Z', now)).toBe(false)
    expect(shouldSendAck('2026-10-08T11:49:00Z', now)).toBe(true)
  })
})
