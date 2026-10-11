// Pure geocoding rules for geocode-bounties. No imports; unit-tested in
// __tests__/unit/geocode-bounties-logic.test.ts.
//
// Same provider and the same rules as the two places that already geocode a
// web post — the website's address autocomplete (Bounty-landing-page
// assets/app.js 5a) and bounty-checkout's text fallback — so a bounty is
// placed the same way whichever path finds it: Photon (OpenStreetMap), biased
// to the DMV, US only, transit stops and admin areas excluded.

export const PHOTON_URL = 'https://photon.komoot.io/api/'
export const DMV_BIAS = { lat: 38.9072, lon: -77.0369 }

const STREET_WORDS: Record<string, string> = {
  st: 'Street', rd: 'Road', ave: 'Avenue', av: 'Avenue', blvd: 'Boulevard', dr: 'Drive',
  ln: 'Lane', ct: 'Court', pl: 'Place', ter: 'Terrace', terr: 'Terrace', pkwy: 'Parkway',
  hwy: 'Highway', cir: 'Circle', sq: 'Square',
  nw: 'Northwest', ne: 'Northeast', sw: 'Southwest', se: 'Southeast',
  n: 'North', s: 'South', e: 'East', w: 'West',
}
const JUNK_OSM_VALUES = ['bus_stop', 'bicycle_rental', 'platform', 'stop_position', 'station', 'charging_station', 'parking_entrance']

/** Photon needs "Road", not "rd". A lone "N" before "St" is a street name, not a direction. */
export function expandAddress(q: string): string {
  const words = q.replace(/\./g, '').replace(/,/g, ' ').split(/\s+/).filter(Boolean)
  return words
    .map((w, i) => {
      const k = w.toLowerCase()
      if (k.length === 1 && /^(st|street)$/i.test(words[i + 1] ?? '')) return w
      return STREET_WORDS[k] ?? w
    })
    .join(' ')
}

export function photonQueryUrl(address: string): string {
  const params = new URLSearchParams({
    limit: '10',
    lang: 'en',
    lat: String(DMV_BIAS.lat),
    lon: String(DMV_BIAS.lon),
    q: expandAddress(address),
  })
  return `${PHOTON_URL}?${params.toString()}`
}

export interface GeocodeHit {
  latitude: number
  longitude: number
  zipCode: string | null
  neighborhood: string | null
  /** True when the house number matched — a street-level result otherwise. */
  exact: boolean
}

export type GeocodeOutcome =
  | { ok: true; hit: GeocodeHit }
  | { ok: false; reason: 'no_address' | 'address_too_short' | 'no_match' | 'provider_error' | 'bad_response' }

/** Picks the best usable feature from a Photon response. */
export function pickGeocodeHit(address: string, response: unknown): GeocodeOutcome {
  const features = (response as { features?: unknown[] } | null)?.features
  if (!Array.isArray(features)) return { ok: false, reason: 'bad_response' }

  const usable = features.filter((f: any) =>
    f?.properties?.countrycode === 'US' &&
    ['house', 'street'].includes(f?.properties?.type) &&
    !JUNK_OSM_VALUES.includes(f?.properties?.osm_value) &&
    Array.isArray(f?.geometry?.coordinates) &&
    f.geometry.coordinates.length >= 2
  ) as any[]

  const num = (address.match(/^\s*(\d+[a-z]?)\b/i) ?? [])[1]?.toLowerCase()
  const exact = num ? usable.find((f) => String(f.properties.housenumber ?? '').toLowerCase() === num) : undefined
  const hit = exact ?? usable[0]
  if (!hit) return { ok: false, reason: 'no_match' }

  const [lon, lat] = hit.geometry.coordinates.map(Number)
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return { ok: false, reason: 'bad_response' }
  }
  const p = hit.properties
  const hood = String(p.locality ?? p.district ?? '').replace(/[<>]/g, '').trim().slice(0, 120)
  return {
    ok: true,
    hit: {
      latitude: lat,
      longitude: lon,
      zipCode: /^\d{5}$/.test(p.postcode ?? '') ? p.postcode : null,
      // DC's "Ward 6" is not a neighborhood anyone would recognise.
      neighborhood: hood && !/^ward\s+\d+$/i.test(hood) ? hood : null,
      exact: Boolean(exact),
    },
  }
}

/** Address present and long enough to be worth a provider call. */
export function precheckAddress(address: string | null | undefined): GeocodeOutcome | null {
  const a = (address ?? '').trim()
  if (!a) return { ok: false, reason: 'no_address' }
  if (a.length < 5) return { ok: false, reason: 'address_too_short' }
  return null
}

/** Failures that retrying won't fix go straight to a person. */
export function isTerminal(reason: string): boolean {
  return reason === 'no_address' || reason === 'address_too_short'
}
