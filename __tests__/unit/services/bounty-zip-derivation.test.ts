/**
 * deriveBountyZipCode (app/services/bountyService.ts) — the ZIP stamped on a
 * bounty drives the exact-ZIP "New Bounty Near You" push, so it must come
 * from the bounty's own address. It used to fall back to the poster's
 * profile ZIP, which sent a job in one city to the poster's home ZIP.
 */

jest.mock('../../../lib/services/bounty-service', () => ({ bountyService: { update: jest.fn() } }));
jest.mock('../../../lib/services/analytics-service', () => ({ analyticsService: { trackEvent: jest.fn() } }));
jest.mock('../../../lib/services/performance-service', () => ({ performanceService: {} }));
jest.mock('../../../lib/services/offline-queue-service', () => ({ offlineQueueService: {} }));
jest.mock('../../../lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabaseEnv: { hasUrl: true, hasKey: true, mismatch: false },
  supabase: { from: jest.fn(() => { throw new Error('must not read profiles'); }) },
}));
jest.mock('../../../lib/utils/data-utils', () => ({ getCurrentUserId: jest.fn().mockReturnValue('user-abc') }));

import { deriveBountyZipCode } from '../../../app/services/bountyService';

describe('deriveBountyZipCode', () => {
  it('uses the ZIP of the resolved place', () => {
    expect(deriveBountyZipCode({ workType: 'in_person', zipCode: '78745', location: 'Zilker, Austin' })).toBe('78745');
  });

  it('normalises ZIP+4 from the geocoder to five digits', () => {
    expect(deriveBountyZipCode({ workType: 'in_person', zipCode: '78745-1234', location: '' })).toBe('78745');
  });

  it('falls back to the ZIP in the address text, after the street number', () => {
    expect(deriveBountyZipCode({ workType: 'in_person', location: '5018 Painters Mill Rd, Owings Mills, MD 21117' })).toBe('21117');
  });

  it('prefers the resolved place over text', () => {
    expect(deriveBountyZipCode({ workType: 'in_person', zipCode: '78704', location: '12345 Some Rd' })).toBe('78704');
  });

  it("ignores a non-US postal code and never falls back to the poster's profile", () => {
    expect(deriveBountyZipCode({ workType: 'in_person', zipCode: 'M5V 2T6', location: 'King St W, Toronto' })).toBeUndefined();
  });

  it('gives online bounties no ZIP', () => {
    expect(deriveBountyZipCode({ workType: 'online', zipCode: '78745', location: '78745' })).toBeUndefined();
  });
});
