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

  const branchKey = Deno.env.get('BRANCH_KEY');
  if (!branchKey) return new Response('App link is not configured', { status: 503 });

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

  await captureRedirect({
    utm_source: source,
    utm_medium: medium,
    utm_campaign: campaign,
    initial_referrer: referrer,
    initial_landing_page: landingPage,
  });

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
    return new Response('App link is temporarily unavailable', { status: 502 });
  }
  const { url } = (await branchResponse.json()) as { url?: string };
  if (!url) return new Response('App link is temporarily unavailable', { status: 502 });

  return Response.redirect(url, 302);
});
