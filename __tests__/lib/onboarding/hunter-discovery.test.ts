// Mocked so this suite never touches expo-location (calculateDistance is
// plain math, but the module also imports the native expo-location package).
jest.mock('../../../lib/services/location-service', () => ({
  locationService: {
    calculateDistance: jest.fn((from: any, to: any) => Math.abs(to.latitude - from.latitude)),
  },
}))

import {
  isLocalBounty,
  rankNearbyBounties,
  withComputedDistance,
} from '../../../lib/onboarding/hunter-discovery'
import { locationService } from '../../../lib/services/location-service'
import type { Bounty } from '../../../lib/services/database.types'

function makeBounty(overrides: Partial<Bounty> = {}): Bounty {
  return {
    id: 'bounty-1',
    title: 'Test bounty',
    description: '',
    amount: 10,
    is_for_honor: false,
    location: 'San Francisco, CA',
    timeline: '',
    skills_required: '',
    poster_id: 'poster-1',
    created_at: new Date().toISOString(),
    status: 'open',
    ...overrides,
  } as Bounty
}

describe('isLocalBounty', () => {
  test('treats missing work_type as local', () => {
    expect(isLocalBounty(makeBounty({ work_type: undefined }))).toBe(true)
    expect(isLocalBounty(makeBounty({ work_type: 'in_person' }))).toBe(true)
  })

  test('excludes online bounties', () => {
    expect(isLocalBounty(makeBounty({ work_type: 'online' }))).toBe(false)
  })
})

describe('withComputedDistance', () => {
  beforeEach(() => jest.clearAllMocks())

  test('returns the bounty unchanged without user coords', () => {
    const bounty = makeBounty({ location: '10, 10' })
    expect(withComputedDistance(bounty, null)).toBe(bounty)
    expect(locationService.calculateDistance).not.toHaveBeenCalled()
  })

  test('returns the bounty unchanged when location is not parseable coordinates', () => {
    const bounty = makeBounty({ location: 'San Francisco, CA' })
    const result = withComputedDistance(bounty, { latitude: 0, longitude: 0 });
    expect(result.distance).toBeUndefined()
    expect(locationService.calculateDistance).not.toHaveBeenCalled()
  })

  test('attaches a real distance when location parses as coordinates', () => {
    const bounty = makeBounty({ location: '10, 10' })
    const result = withComputedDistance(bounty, { latitude: 0, longitude: 0 })
    expect(locationService.calculateDistance).toHaveBeenCalledTimes(1)
    expect(result.distance).toBe(10)
  })
})

describe('rankNearbyBounties', () => {
  beforeEach(() => jest.clearAllMocks())

  test('excludes online bounties', () => {
    const bounties = [
      makeBounty({ id: 'remote', work_type: 'online' }),
      makeBounty({ id: 'local', work_type: 'in_person', location: 'Oakland, CA' }),
    ]
    const ranked = rankNearbyBounties(bounties, null)
    expect(ranked.map((b) => b.id)).toEqual(['local'])
  })

  test('sorts measured bounties nearest-first, ahead of unmeasured ones', () => {
    const near = makeBounty({ id: 'near', location: '1, 1' })
    const far = makeBounty({ id: 'far', location: '5, 5' })
    const unmeasured = makeBounty({ id: 'unmeasured', location: 'Somewhere, TX' })
    const ranked = rankNearbyBounties([far, unmeasured, near], { latitude: 0, longitude: 0 })
    expect(ranked.map((b) => b.id)).toEqual(['near', 'far', 'unmeasured'])
  })

  test('excludes measured bounties beyond the search radius, but keeps unmeasurable ones', () => {
    const inRange = makeBounty({ id: 'in-range', location: '1, 1' })
    const outOfRange = makeBounty({ id: 'out-of-range', location: '50, 50' })
    const unmeasured = makeBounty({ id: 'unmeasured', location: 'Somewhere, TX' })
    const ranked = rankNearbyBounties([inRange, outOfRange, unmeasured], { latitude: 0, longitude: 0 }, 10)
    expect(ranked.map((b) => b.id)).toEqual(['in-range', 'unmeasured'])
  })

  test('sorts unmeasured bounties by recency when no user coords are available', () => {
    const older = makeBounty({ id: 'older', created_at: new Date(2020, 0, 1).toISOString() })
    const newer = makeBounty({ id: 'newer', created_at: new Date(2024, 0, 1).toISOString() })
    const ranked = rankNearbyBounties([older, newer], null)
    expect(ranked.map((b) => b.id)).toEqual(['newer', 'older'])
  })
})
