import { normalizeRecipients } from '../../supabase/functions/process-notification/recipients'

describe('normalizeRecipients', () => {
  test('null -> empty', () => {
    expect(normalizeRecipients(null)).toEqual([])
  })

  test('array of strings -> trimmed array', () => {
    expect(normalizeRecipients([' a ', 'b', null, 3])).toEqual(['a', 'b'])
  })

  test('json string array -> parsed', () => {
    expect(normalizeRecipients('["x","y"]')).toEqual(['x', 'y'])
  })

  test('json string single -> parsed', () => {
    expect(normalizeRecipients('"z"')).toEqual(['z'])
  })

  test('plain string -> single', () => {
    expect(normalizeRecipients('token123')).toEqual(['token123'])
  })

  test('object with ids -> ids array', () => {
    expect(normalizeRecipients({ ids: ['u1', 'u2'] })).toEqual(['u1', 'u2'])
  })

  test('object with string values -> collect', () => {
    expect(normalizeRecipients({ a: 'v1', b: 2 })).toEqual(['v1'])
  })

  test('malformed json string -> fallback to raw', () => {
    expect(normalizeRecipients('not-json')).toEqual(['not-json'])
  })
})
