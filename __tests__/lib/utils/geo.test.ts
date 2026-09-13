import { extractZipFromText, isValidUsZip, parseCoordsFromLocation } from '../../../lib/utils/geo'

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

  test('extractZipFromText pulls the ZIP out of a full address', () => {
    expect(extractZipFromText('5018 Painters Mill Road, Owings Mills, MD 21117')).toBe('21117')
    expect(extractZipFromText('11989A Reisterstown Rd, Reisterstown, MD 21136')).toBe('21136')
    expect(extractZipFromText('Crescentwood Ave, Warren, MI, 48021')).toBe('48021')
  })

  test('extractZipFromText prefers the last 5-digit token over a leading street number', () => {
    expect(extractZipFromText('5018 Main St, Baltimore, MD 21201')).toBe('21201')
  })

  test('extractZipFromText accepts a bare ZIP', () => {
    expect(extractZipFromText('21201')).toBe('21201')
  })

  test('extractZipFromText returns null for text with no standalone 5-digit token', () => {
    expect(extractZipFromText('Bmore')).toBeNull()
    expect(extractZipFromText('DMV')).toBeNull()
    expect(extractZipFromText('122 main st')).toBeNull()
    expect(extractZipFromText('')).toBeNull()
    expect(extractZipFromText(null)).toBeNull()
    expect(extractZipFromText(undefined)).toBeNull()
  })
})
