import { isValidUsZip, parseCoordsFromLocation } from '../../../lib/utils/geo'

describe('geo utils', () => {
  test('parseCoordsFromLocation parses "lat, lng" strings', () => {
    expect(parseCoordsFromLocation('37.774, -122.419')).toEqual({ latitude: 37.774, longitude: -122.419 })
    expect(parseCoordsFromLocation('37.774,-122.419')).toEqual({ latitude: 37.774, longitude: -122.419 })
  })

  test('parseCoordsFromLocation returns null for human-readable addresses', () => {
    expect(parseCoordsFromLocation('San Francisco, CA')).toBeNull()
    expect(parseCoordsFromLocation('123 Main St')).toBeNull()
  })

  test('parseCoordsFromLocation returns null for empty/missing input', () => {
    expect(parseCoordsFromLocation('')).toBeNull()
    expect(parseCoordsFromLocation(null)).toBeNull()
    expect(parseCoordsFromLocation(undefined)).toBeNull()
  })

  test('isValidUsZip accepts 5-digit codes', () => {
    expect(isValidUsZip('94103')).toBe(true)
    expect(isValidUsZip(' 94103 ')).toBe(true)
  })

  test('isValidUsZip rejects malformed input', () => {
    expect(isValidUsZip('')).toBe(false)
    expect(isValidUsZip('941')).toBe(false)
    expect(isValidUsZip('941035')).toBe(false)
    expect(isValidUsZip('9410a')).toBe(false)
    expect(isValidUsZip('94103-1234')).toBe(false)
  })
})
