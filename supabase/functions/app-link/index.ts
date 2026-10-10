const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
};

function slug(value: string | undefined, fallback: string): string {
  const normalized = (value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-|-$/g, '');
  return normalized.slice(0, 100) || fallback;
}

const APP_STORE_URL = 'https://apps.apple.com/app/id6756679797';
const PLAY_STORE_PACKAGE = 'app.bountyfinder.BOUNTYExpo';

// Used when Branch is not configured or link creation fails. Never redirects to
// the caller-supplied `landing` param, so this cannot become an open redirect.
function storeFallbackUrl(
  userAgent: string,
  origin: string,
  utm: { source: string; medium: string; campaign: string }
): string {
  if (/iphone|ipad|ipod/i.test(userAgent)) return APP_STORE_URL;
  if (/android/i.test(userAgent)) {
    const referrer = new URLSearchParams({
      utm_source: utm.source,
      utm_medium: utm.medium,
      utm_campaign: utm.campaign,
    }).toString();
    return `https://play.google.com/store/apps/details?${new URLSearchParams({
      id: PLAY_STORE_PACKAGE,
      referrer,
    })}`;
  }
  return origin;
}

async function captureRedirect(properties: Record<string, unknown>): Promise<void> {
  const apiKey = Deno.env.get('POSTHOG_PROJECT_API_KEY');
  if (!apiKey) return;
  const host = Deno.env.get('POSTHOG_HOST') ?? 'https://us.i.posthog.com';
  try {
    await fetch(`${host}/capture/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(3000),
      body: JSON.stringify({
        api_key: apiKey,
        event: 'app_store_redirect_clicked',
        properties: {
          distinct_id: crypto.randomUUID(),
          ...properties,
        },
      }),
    });
  } catch (error) {
    console.error('[app-link] PostHog capture failed', error);
  }
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });

  const requestUrl = new URL(request.url);
  const segments = requestUrl.pathname.split('/').filter(Boolean);
  const functionIndex = segments.lastIndexOf('app-link');
  const source = slug(segments[functionIndex + 1], 'direct');
  const campaign = slug(segments[functionIndex + 2], 'general');
  const medium = slug(
    requestUrl.searchParams.get('medium') ?? undefined,
    source === 'share' ? 'organic' : 'guerilla'
  );
  const deepLinkPath = requestUrl.searchParams.get('path')?.replace(/^\/+/, '').slice(0, 500);
  const configuredOrigin = Deno.env.get('PUBLIC_MARKETING_ORIGIN') ?? 'https://bountyfinder.net';
  const landingPage =
    requestUrl.searchParams.get('landing')?.slice(0, 1000) ??
    `${configuredOrigin}/r/${source}/${campaign}`;
  const referrer = request.headers.get('referer')?.slice(0, 1000);
  const fallbackUrl = storeFallbackUrl(request.headers.get('user-agent') ?? '', configuredOrigin, {
    source,
    medium,
    campaign,
  });

  const branchKey = Deno.env.get('BRANCH_KEY');

  await captureRedirect({
    utm_source: source,
    utm_medium: medium,
    utm_campaign: campaign,
    initial_referrer: referrer,
    initial_landing_page: landingPage,
    link_provider: branchKey ? 'branch' : 'store_fallback',
  });

  if (!branchKey) return Response.redirect(fallbackUrl, 302);

  let url: string | undefined;
  try {
    const branchResponse = await fetch('https://api2.branch.io/v1/url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify({
        branch_key: branchKey,
        channel: source,
        feature: medium,
        campaign,
        data: {
          ...(deepLinkPath ? { $deeplink_path: deepLinkPath } : {}),
          $canonical_url: landingPage,
          utm_source: source,
          utm_medium: medium,
          utm_campaign: campaign,
          initial_referrer: referrer,
          initial_landing_page: landingPage,
          install_source: source,
          install_campaign: campaign,
        },
      }),
    });
    if (!branchResponse.ok) {
      console.error('[app-link] Branch link creation failed', branchResponse.status);
    } else {
      ({ url } = (await branchResponse.json()) as { url?: string });
    }
  } catch (error) {
    console.error('[app-link] Branch link creation failed', error);
  }

  return Response.redirect(url ?? fallbackUrl, 302);
});
