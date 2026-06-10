import { extractInvalidTokens } from '../../supabase/functions/process-notification/push-receipts'

describe('extractInvalidTokens', () => {
  const tokens = ['ExponentPushToken[a]', 'ExponentPushToken[b]', 'ExponentPushToken[c]']

  test('returns empty when body has no data array', () => {
    expect(extractInvalidTokens(tokens, null)).toEqual([])
    expect(extractInvalidTokens(tokens, {})).toEqual([])
    expect(extractInvalidTokens(tokens, { data: 'nope' })).toEqual([])
  })

  test('returns empty when all tickets are ok', () => {
    const body = { data: [{ status: 'ok' }, { status: 'ok' }, { status: 'ok' }] }
    expect(extractInvalidTokens(tokens, body)).toEqual([])
  })

  test('flags DeviceNotRegistered token by position', () => {
    const body = {
      data: [
        { status: 'ok' },
        { status: 'error', details: { error: 'DeviceNotRegistered' } },
        { status: 'ok' },
      ],
    }
    expect(extractInvalidTokens(tokens, body)).toEqual(['ExponentPushToken[b]'])
  })

  test('flags InvalidCredentials token', () => {
    const body = {
      data: [{ status: 'error', details: { error: 'InvalidCredentials' } }],
    }
    expect(extractInvalidTokens(tokens, body)).toEqual(['ExponentPushToken[a]'])
  })

  test('ignores transient errors like MessageRateExceeded', () => {
    const body = {
      data: [{ status: 'error', details: { error: 'MessageRateExceeded' } }],
    }
    expect(extractInvalidTokens(tokens, body)).toEqual([])
  })

  test('handles multiple dead tokens', () => {
    const body = {
      data: [
        { status: 'error', details: { error: 'DeviceNotRegistered' } },
        { status: 'ok' },
        { status: 'error', details: { error: 'DeviceNotRegistered' } },
      ],
    }
    expect(extractInvalidTokens(tokens, body)).toEqual(['ExponentPushToken[a]', 'ExponentPushToken[c]'])
  })
})
