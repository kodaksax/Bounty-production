/**
 * The ISO country in Cloudflare's `cf-ipcountry` request header, or null when
 * the header is missing or holds one of Cloudflare's non-countries
 * (XX = unknown, T1 = Tor).
 */
export function countryFromCfHeader(value: string | null | undefined): string | null {
  const code = value?.trim().toUpperCase();
  if (!code || !/^[A-Z]{2}$/.test(code) || code === 'XX') return null;
  return code;
}
