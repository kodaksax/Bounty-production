/**
 * Works out where the user is for the service-area check: the country of the
 * GPS fix when location is already granted, then the request's IP country, else
 * unknown. Never prompts for permission and never reads the phone's language.
 *
 * The `geo-country` edge function isn't deployed yet. Until it is, the call
 * fails and those users stay `unknown`, which shows them nothing.
 */

import { API_TIMEOUTS } from '../config/network';
import { supabase } from '../supabase';
import {
  buildServiceabilityContext,
  getServiceabilityContext,
  setServiceabilityContext,
  type RegionContext,
} from '../utils/serviceable-region';
import { withTimeout } from '../utils/withTimeout';
import { locationService } from './location-service';

const GPS_FIX_TIMEOUT_MS = 6000;
/** A GPS answer stands for the app run; anything weaker is retried at most this often. */
const RETRY_AFTER_MS = 10 * 60 * 1000;

let inFlight: Promise<RegionContext> | null = null;
let lastAttemptAt: number | null = null;

async function contextFromGps(): Promise<RegionContext | null> {
  try {
    const permission = await locationService.getPermissionStatus();
    if (!permission.granted) return null;

    const coords =
      locationService.getCachedLocation() ??
      (await withTimeout(locationService.getCurrentLocation(), GPS_FIX_TIMEOUT_MS));
    if (!coords) return null;

    const place = await locationService.reverseGeocodeRegion(coords);
    const context = buildServiceabilityContext({
      countryCode: place?.countryCode,
      region: place?.region,
      source: 'gps',
    });
    return context.serviceable_source === 'unknown' ? null : context;
  } catch {
    return null;
  }
}

async function contextFromIp(): Promise<RegionContext | null> {
  try {
    const { data, error } = await withTimeout(
      supabase.functions.invoke<{ country_code?: string | null }>('geo-country', { method: 'GET' }),
      API_TIMEOUTS.QUICK
    );
    if (error) return null;
    const context = buildServiceabilityContext({ countryCode: data?.country_code, source: 'ip' });
    return context.serviceable_source === 'unknown' ? null : context;
  } catch {
    return null;
  }
}

async function resolve(): Promise<RegionContext> {
  const next = (await contextFromGps()) ?? (await contextFromIp());
  if (next) setServiceabilityContext(next);
  return getServiceabilityContext();
}

/** Resolves the current context, sharing one lookup between concurrent callers. */
export function resolveServiceability(): Promise<RegionContext> {
  const current = getServiceabilityContext();
  if (current.serviceable_source === 'gps') return Promise.resolve(current);
  if (inFlight) return inFlight;
  if (lastAttemptAt !== null && Date.now() - lastAttemptAt < RETRY_AFTER_MS) {
    return Promise.resolve(current);
  }

  lastAttemptAt = Date.now();
  inFlight = resolve().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** For screens that already reverse-geocoded a fix, so it isn't geocoded twice. */
export function recordGpsCountry(countryCode?: string | null, region?: string | null): void {
  const context = buildServiceabilityContext({ countryCode, region, source: 'gps' });
  if (context.serviceable_source !== 'unknown') setServiceabilityContext(context);
}

/** Test seam. */
export function __resetServiceabilityServiceForTests(): void {
  inFlight = null;
  lastAttemptAt = null;
}
