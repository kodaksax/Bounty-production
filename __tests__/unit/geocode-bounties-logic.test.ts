import {
  expandAddress,
  isTerminal,
  photonQueryUrl,
  pickGeocodeHit,
  precheckAddress,
} from '../../supabase/functions/geocode-bounties/logic'

const feature = (props: Record<string, unknown>, coords: unknown = [-77.0469, 38.8048]) => ({
  properties: { countrycode: 'US', type: 'house', osm_value: 'yes', ...props },
  geometry: { coordinates: coords },
})

describe('pickGeocodeHit', () => {
  test('successful geocoding, preferring the matching house number', () => {
    const response = {
      features: [
        feature({ housenumber: '100', postcode: '22314', locality: 'Old Town' }, [-77.05, 38.80]),
        feature({ housenumber: '123', postcode: '22314', locality: 'Old Town' }, [-77.0469, 38.8048]),
      ],
    }
    const r = pickGeocodeHit('123 King St, Alexandria, VA', response)
    expect(r).toEqual({
      ok: true,
      hit: { latitude: 38.8048, longitude: -77.0469, zipCode: '22314', neighborhood: 'Old Town', exact: true },
    })
  })

  test('falls back to the best street-level match when no house number matches', () => {
    const r = pickGeocodeHit('999 King St', { features: [feature({ housenumber: '1' })] })
    expect(r.ok && r.hit.exact).toBe(false)
  })

  test('ignores transit stops, admin areas and non-US results', () => {
    const r = pickGeocodeHit('King St', {
      features: [
        feature({ osm_value: 'bus_stop' }),
        feature({ type: 'state' }),
        feature({ countrycode: 'CA' }),
      ],
    })
    expect(r).toEqual({ ok: false, reason: 'no_match' })
  })

  test('missing geocoding results', () => {
    expect(pickGeocodeHit('Nowhere Lane', { features: [] })).toEqual({ ok: false, reason: 'no_match' })
  })

  test('provider returned garbage', () => {
    expect(pickGeocodeHit('x', null)).toEqual({ ok: false, reason: 'bad_response' })
    expect(pickGeocodeHit('x', { features: [feature({}, ['a', 'b'])] })).toEqual({ ok: false, reason: 'bad_response' })
    expect(pickGeocodeHit('x', { features: [feature({}, [-500, 95])] })).toEqual({ ok: false, reason: 'bad_response' })
  })

  test('DC wards are not neighborhoods; bad postcodes are dropped', () => {
    const r = pickGeocodeHit('1 Main St', { features: [feature({ housenumber: '1', locality: 'Ward 6', postcode: 'ABC' })] })
    expect(r.ok && r.hit.neighborhood).toBeNull()
    expect(r.ok && r.hit.zipCode).toBeNull()
  })
})

describe('precheckAddress — a missing address goes to a person, not to the provider', () => {
  test('missing address', () => {
    expect(precheckAddress(null)).toEqual({ ok: false, reason: 'no_address' })
    expect(precheckAddress('   ')).toEqual({ ok: false, reason: 'no_address' })
    expect(isTerminal('no_address')).toBe(true)
  })
  test('too short to look up', () => {
    expect(precheckAddress('VA')).toEqual({ ok: false, reason: 'address_too_short' })
    expect(isTerminal('address_too_short')).toBe(true)
  })
  test('usable address passes; provider failures are retried, not terminal', () => {
    expect(precheckAddress('123 King St')).toBeNull()
    expect(isTerminal('provider_error')).toBe(false)
    expect(isTerminal('no_match')).toBe(false)
  })
})

describe('query building', () => {
  test('expands street abbreviations the way the website does', () => {
    expect(expandAddress('123 N. Washington St., Alexandria')).toBe('123 North Washington Street Alexandria')
    expect(expandAddress('1 N St NW')).toBe('1 N Street Northwest')
  })
  test('is biased to the DMV and carries only the address', () => {
    const url = new URL(photonQueryUrl('123 King St'))
    expect(url.hostname).toBe('photon.komoot.io')
    expect(url.searchParams.get('q')).toBe('123 King Street')
    expect(url.searchParams.get('lat')).toBe('38.9072')
  })
})
