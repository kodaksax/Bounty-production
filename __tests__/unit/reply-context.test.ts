import {
  createReplyContext,
  generateReplyToken,
  parseReplyToken,
  replyAddressFor,
  REPLY_CONTEXT_TTL_DAYS,
  resolveReplyDomain,
} from '../../supabase/functions/_shared/reply-context'

const DOMAIN = 'reply.bountyfinder.net'

describe('reply addresses', () => {
  test('tokens are 26 base32 chars and differ each time', () => {
    const a = generateReplyToken()
    const b = generateReplyToken()
    expect(a).toMatch(/^[a-z2-7]{26}$/)
    expect(a).not.toBe(b)
  })

  test('round-trips through an address, including display-name forms and cc lists', () => {
    const token = generateReplyToken()
    const address = replyAddressFor(token, DOMAIN)
    expect(parseReplyToken([address], DOMAIN)).toBe(token)
    expect(parseReplyToken(`Bounty <${address.toUpperCase()}>`, DOMAIN)).toBe(token)
    expect(parseReplyToken(['friend@example.com', address], DOMAIN)).toBe(token)
  })

  // A reply that can't be matched must never be guessed at.
  test('unmatched replies resolve to nothing', () => {
    const token = generateReplyToken()
    expect(parseReplyToken([`reply+${token}@evil.example`], DOMAIN)).toBeNull()
    expect(parseReplyToken(['support@bountyfinder.app'], DOMAIN)).toBeNull()
    expect(parseReplyToken([`reply+short@${DOMAIN}`], DOMAIN)).toBeNull()
    expect(parseReplyToken([`reply+${token}@${DOMAIN}`], null)).toBeNull()
    expect(parseReplyToken(undefined, DOMAIN)).toBeNull()
  })

  test('the reply domain must be a bare host or the feature stays off', () => {
    expect(resolveReplyDomain('Reply.BountyFinder.net ')).toBe(DOMAIN)
    expect(resolveReplyDomain('')).toBeNull()
    expect(resolveReplyDomain('support@bountyfinder.app')).toBeNull()
    expect(resolveReplyDomain('https://reply.bountyfinder.net')).toBeNull()
  })
})

describe('createReplyContext', () => {
  test('stores the context with an expiry and returns its token', async () => {
    const inserted: Record<string, unknown>[] = []
    const client = { from: () => ({ insert: async (row: Record<string, unknown>) => (inserted.push(row), { error: null }) }) }
    const now = new Date('2026-10-08T12:00:00Z')
    const token = await createReplyContext(client, { posterId: 'p', bountyId: 'b', requestId: 'r', notificationType: 'application' }, now)
    expect(token).toMatch(/^[a-z2-7]{26}$/)
    expect(inserted[0]).toMatchObject({ token, poster_id: 'p', bounty_id: 'b', request_id: 'r' })
    expect(Date.parse(inserted[0].expires_at as string) - now.getTime()).toBe(REPLY_CONTEXT_TTL_DAYS * 86_400_000)
  })

  test('a storage failure returns null so the email still goes out (to support)', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const client = { from: () => ({ insert: async () => ({ error: { message: 'boom' } }) }) }
    expect(await createReplyContext(client, { posterId: 'p', bountyId: 'b', requestId: null, notificationType: 'x' })).toBeNull()
    spy.mockRestore()
  })
})
