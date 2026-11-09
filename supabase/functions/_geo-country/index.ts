// Supabase Edge Function: geo-country
// Returns the caller's country from the request's IP, for the service-area check
// when the app has no GPS fix. It reads one header and stores nothing.
//
// HELD BACK: the leading underscore keeps this out of CI's deploy, which skips
// `_*` directories. To release it, rename the folder to `geo-country`.
// Gateway JWT verification stays on (the default).

import { countryFromCfHeader } from '../_shared/ip-country.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

Deno.serve((req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const body = { country_code: countryFromCfHeader(req.headers.get('cf-ipcountry')) };
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
});
