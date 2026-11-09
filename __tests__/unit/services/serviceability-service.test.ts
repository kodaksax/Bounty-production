/**
 * The service-area check: GPS country, then IP country, else unknown. The OS
 * geocoder is faked here with the answers it gives for each place, so these
 * cover our logic and not the geocoder itself.
 */

const mockGetPermissionStatus = jest.fn();
const mockRequestPermission = jest.fn();
const mockGetCachedLocation = jest.fn();
const mockGetCurrentLocation = jest.fn();
const mockReverseGeocodeRegion = jest.fn();
jest.mock('../../../lib/services/location-service', () => ({
  locationService: {
    getPermissionStatus: (...a: unknown[]) => mockGetPermissionStatus(...a),
    requestPermission: (...a: unknown[]) => mockRequestPermission(...a),
    getCachedLocation: (...a: unknown[]) => mockGetCachedLocation(...a),
    getCurrentLocation: (...a: unknown[]) => mockGetCurrentLocation(...a),
    reverseGeocodeRegion: (...a: unknown[]) => mockReverseGeocodeRegion(...a),
  },
}));

const mockInvoke = jest.fn();
jest.mock('../../../lib/supabase', () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => mockInvoke(...a) } },
}));

// If the check ever reads the language again, this phone would pass as US.
const mockGetDeviceLocale = jest.fn(() => 'en-US');
jest.mock('../../../lib/utils', () => ({
  getDeviceLocale: () => mockGetDeviceLocale(),
}));

import {
  __resetServiceabilityServiceForTests,
  recordGpsCountry,
  resolveServiceability,
} from '../../../lib/services/serviceability-service';
import {
  __resetServiceabilityContextForTests,
  getServiceabilityContext,
  isOutOfServiceArea,
} from '../../../lib/utils/serviceable-region';

const PLACES = {
  queretaro: { coords: { latitude: 20.5888, longitude: -100.3899 }, countryCode: 'MX', region: 'Qro.' },
  tijuana: { coords: { latitude: 32.5149, longitude: -117.0382 }, countryCode: 'MX', region: 'B.C.' },
  lagos: { coords: { latitude: 6.5244, longitude: 3.3792 }, countryCode: 'NG', region: 'Lagos' },
  losAngeles: { coords: { latitude: 34.0522, longitude: -118.2437 }, countryCode: 'US', region: 'CA' },
  washingtonDc: { coords: { latitude: 38.9072, longitude: -77.0369 }, countryCode: 'US', region: 'DC' },
};

function locatedAt(place: (typeof PLACES)[keyof typeof PLACES]) {
  mockGetPermissionStatus.mockResolvedValue({ granted: true, canAskAgain: true, status: 'granted' });
  mockGetCurrentLocation.mockResolvedValue(place.coords);
  mockReverseGeocodeRegion.mockResolvedValue({ countryCode: place.countryCode, region: place.region });
}

function locationDenied() {
  mockGetPermissionStatus.mockResolvedValue({ granted: false, canAskAgain: false, status: 'denied' });
}

beforeEach(() => {
  jest.clearAllMocks();
  __resetServiceabilityContextForTests();
  __resetServiceabilityServiceForTests();
  mockGetCachedLocation.mockReturnValue(null);
  mockGetDeviceLocale.mockReturnValue('en-US');
  // Today's reality: the function isn't deployed.
  mockInvoke.mockResolvedValue({ data: null, error: new Error('404') });
});

describe('resolveServiceability from GPS', () => {
  it.each([
    ['Queretaro MX', PLACES.queretaro, false, 'MX'],
    ['Tijuana MX', PLACES.tijuana, false, 'MX'],
    ['Lagos NG', PLACES.lagos, false, 'NG'],
    ['Los Angeles', PLACES.losAngeles, true, 'US'],
    ['Washington DC', PLACES.washingtonDc, true, 'US'],
  ])('%s', async (_name, place, serviceable, country) => {
    locatedAt(place);
    await expect(resolveServiceability()).resolves.toEqual({
      country_code: country,
      region: place.region,
      is_serviceable_region: serviceable,
      serviceable_source: 'gps',
    });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('a phone set to en-US, located in Queretaro, is not serviceable', async () => {
    mockGetDeviceLocale.mockReturnValue('en-US');
    locatedAt(PLACES.queretaro);
    const context = await resolveServiceability();
    expect(context.is_serviceable_region).toBe(false);
    expect(context.country_code).toBe('MX');
    expect(isOutOfServiceArea(context)).toBe(true);
    expect(mockGetDeviceLocale).not.toHaveBeenCalled();
  });

  it('a phone set to es-MX, located in Los Angeles, is serviceable', async () => {
    mockGetDeviceLocale.mockReturnValue('es-MX');
    locatedAt(PLACES.losAngeles);
    await expect(resolveServiceability()).resolves.toMatchObject({
      is_serviceable_region: true,
      serviceable_source: 'gps',
    });
  });

  it('never asks for location permission', async () => {
    locationDenied();
    await resolveServiceability();
    expect(mockRequestPermission).not.toHaveBeenCalled();
    expect(mockGetCurrentLocation).not.toHaveBeenCalled();
  });

  it('reuses a fix the app already has', async () => {
    locatedAt(PLACES.losAngeles);
    mockGetCachedLocation.mockReturnValue(PLACES.losAngeles.coords);
    await resolveServiceability();
    expect(mockGetCurrentLocation).not.toHaveBeenCalled();
  });
});

describe('resolveServiceability fallbacks', () => {
  it('uses the IP country when location is denied', async () => {
    locationDenied();
    mockInvoke.mockResolvedValue({ data: { country_code: 'NG' }, error: null });
    await expect(resolveServiceability()).resolves.toEqual({
      country_code: 'NG',
      region: undefined,
      is_serviceable_region: false,
      serviceable_source: 'ip',
    });
    expect(mockInvoke).toHaveBeenCalledWith('geo-country', { method: 'GET' });
  });

  it('uses the IP country when the geocoder fails', async () => {
    locatedAt(PLACES.losAngeles);
    mockReverseGeocodeRegion.mockResolvedValue(null);
    mockInvoke.mockResolvedValue({ data: { country_code: 'US' }, error: null });
    await expect(resolveServiceability()).resolves.toMatchObject({ serviceable_source: 'ip' });
  });

  it('is unknown while the edge function is not deployed', async () => {
    locationDenied();
    const context = await resolveServiceability();
    expect(context).toEqual({ serviceable_source: 'unknown' });
    expect(context.is_serviceable_region).toBeUndefined();
    expect(isOutOfServiceArea(context)).toBe(false);
  });

  it('is unknown when the call throws', async () => {
    locationDenied();
    mockInvoke.mockRejectedValue(new Error('offline'));
    await expect(resolveServiceability()).resolves.toEqual({ serviceable_source: 'unknown' });
  });

  it('is unknown when the function has no country', async () => {
    locationDenied();
    mockInvoke.mockResolvedValue({ data: { country_code: null }, error: null });
    await expect(resolveServiceability()).resolves.toEqual({ serviceable_source: 'unknown' });
  });
});

describe('resolveServiceability lookups', () => {
  it('shares one lookup between concurrent callers', async () => {
    locatedAt(PLACES.losAngeles);
    await Promise.all([resolveServiceability(), resolveServiceability()]);
    expect(mockReverseGeocodeRegion).toHaveBeenCalledTimes(1);
  });

  it('keeps a GPS answer for the app run', async () => {
    locatedAt(PLACES.losAngeles);
    await resolveServiceability();
    await resolveServiceability();
    expect(mockReverseGeocodeRegion).toHaveBeenCalledTimes(1);
  });

  it('does not retry an unknown answer straight away', async () => {
    locationDenied();
    await resolveServiceability();
    await resolveServiceability();
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });
});

describe('recordGpsCountry', () => {
  it('makes the first feed view after onboarding located', () => {
    recordGpsCountry('MX', 'Qro.');
    expect(getServiceabilityContext()).toMatchObject({
      country_code: 'MX',
      is_serviceable_region: false,
      serviceable_source: 'gps',
    });
  });

  it('ignores a missing country', () => {
    recordGpsCountry(undefined, undefined);
    expect(getServiceabilityContext()).toEqual({ serviceable_source: 'unknown' });
  });
});
