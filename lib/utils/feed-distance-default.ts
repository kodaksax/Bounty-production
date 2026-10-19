/**
 * The hunter feed's default distance (SBA-02, docs/audits/shoal-behavioral-audit.md).
 *
 * A hunter with a location sees in-person work within LOCAL_DEFAULT_RADIUS_MILES
 * by default, plus every online job. That is what "For You" means for them;
 * the category, Online and Highest-pay chips narrow it without dropping the
 * radius. A hunter with no location keeps "Any distance".
 *
 * Picking "Any distance" is remembered (DISTANCE_PREFERENCE_KEY), the same way
 * BE:lastFilter remembers the category, and turns the local default off. Picking
 * any radius clears that, so the local default comes back.
 */

/** 'off' = no radius. A number is a radius in miles. null = "Anywhere" (sorted, uncapped). */
export type DistanceFilterValue = 'off' | number | null;

export const DISTANCE_OFF: DistanceFilterValue = 'off';
export const LOCAL_DEFAULT_RADIUS_MILES = 25;
export const DISTANCE_PREFERENCE_KEY = 'BE:distancePreference';

/** 'any' = the hunter chose "Any distance". Anything else = use the local default. */
export type DistancePreference = 'any' | 'local';

export function parseDistancePreference(raw: string | null | undefined): DistancePreference {
  return raw === 'any' ? 'any' : 'local';
}

export function resolveDefaultDistance(params: {
  hasLocation: boolean;
  preference: DistancePreference;
}): DistanceFilterValue {
  return params.hasLocation && params.preference !== 'any' ? LOCAL_DEFAULT_RADIUS_MILES : DISTANCE_OFF;
}

/** The preference a chip pick should store. */
export function preferenceForPick(value: DistanceFilterValue): DistancePreference {
  return value === DISTANCE_OFF ? 'any' : 'local';
}

/**
 * What a chip pick leaves in the feed: the stored preference, the default it
 * implies, and the explicit override (undefined when the pick equals that
 * default, so For You reads as active again).
 */
export function applyDistancePick(params: {
  value: DistanceFilterValue;
  hasLocation: boolean;
}): {
  preference: DistancePreference;
  defaultDistance: DistanceFilterValue;
  override: DistanceFilterValue | undefined;
} {
  const preference = preferenceForPick(params.value);
  const defaultDistance = resolveDefaultDistance({ hasLocation: params.hasLocation, preference });
  return {
    preference,
    defaultDistance,
    override: Object.is(params.value, defaultDistance) ? undefined : params.value,
  };
}

/** Whether a radius search should keep online jobs: always, when a radius is set. */
export function includeOnlineFor(value: DistanceFilterValue): boolean {
  return value !== DISTANCE_OFF;
}
