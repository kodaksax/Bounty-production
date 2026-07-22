// Shared HTML template + helpers for the public share pages
// (share-bounty, share-profile). These pages exist purely so a shared
// bountyfinder.app/bounty|profile link unfurls into a rich preview in
// iMessage/Slack/Discord/X/etc, and otherwise smart-redirects a real visitor
// into the app (or a store listing) instead of showing raw JSON/a 404.

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export interface OgPageOptions {
  title: string;
  description: string;
  imageUrl: string;
  canonicalUrl: string;
  /** Custom-scheme deep link, e.g. bountyexpo-workspace://bounty/123 */
  appDeepLink: string;
  /** iOS App Store URL, once the app is listed (TODO: fill in real numeric App Store ID). */
  iosStoreUrl?: string;
  /** Android Play Store URL. */
  androidStoreUrl?: string;
  siteName?: string;
}

export function renderOgPage(opts: OgPageOptions): string {
  const {
    title,
    description,
    imageUrl,
    canonicalUrl,
    appDeepLink,
    iosStoreUrl,
    androidStoreUrl,
    siteName = 'Bounty',
  } = opts;

  const safeTitle = escapeHtml(title);
  const safeDescription = escapeHtml(description);
  const safeSiteName = escapeHtml(siteName);

  // Always emitted, regardless of whether the requester looked like a
  // crawler: bot detection is UA-sniffing (inherently unreliable), and the
  // page is cached/re-served from Storage by content id, not per-request —
  // gating this on isBot risks a real visitor being served a cached
  // no-script copy that a crawler's request happened to generate moments
  // earlier. Crawlers never execute <script> anyway, so unconditionally
  // including it is free for them and safe for everyone else.
  const redirectScript = `
  <script>
    (function () {
      var appUrl = ${JSON.stringify(appDeepLink)};
      var iosStore = ${JSON.stringify(iosStoreUrl || '')};
      var androidStore = ${JSON.stringify(androidStoreUrl || '')};
      var logUrl = ${JSON.stringify(canonicalUrl)};
      var ua = navigator.userAgent || '';
      var isIOS = /iPhone|iPad|iPod/i.test(ua);
      var isAndroid = /Android/i.test(ua);
      var storeUrl = isIOS ? iosStore : (isAndroid ? androidStore : '');
      var left = false;
      document.addEventListener('visibilitychange', function () {
        if (document.hidden) left = true;
      });
      function beacon(eventType) {
        try {
          var url = logUrl + (logUrl.indexOf('?') === -1 ? '?' : '&') + 'log=' + eventType;
          if (navigator.sendBeacon) navigator.sendBeacon(url);
          else fetch(url, { mode: 'no-cors', keepalive: true });
        } catch (e) {}
      }
      try { window.location.href = appUrl; } catch (e) {}
      setTimeout(function () {
        if (left) {
          beacon('app_redirect');
          return;
        }
        if (storeUrl) {
          beacon('store_redirect');
          window.location.href = storeUrl;
        }
      }, 1200);
    })();
  </script>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${safeTitle}</title>
<meta name="description" content="${safeDescription}" />
<link rel="canonical" href="${canonicalUrl}" />

<meta property="og:type" content="website" />
<meta property="og:site_name" content="${safeSiteName}" />
<meta property="og:title" content="${safeTitle}" />
<meta property="og:description" content="${safeDescription}" />
<meta property="og:image" content="${imageUrl}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:url" content="${canonicalUrl}" />

<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${safeTitle}" />
<meta name="twitter:description" content="${safeDescription}" />
<meta name="twitter:image" content="${imageUrl}" />
<style>
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
    background:#0B0F14; color:#fff; }
  @media (prefers-color-scheme: light) { body { background:#f5f5f5; color:#0B0F14; } }
  .card { max-width:440px; padding:32px 24px; text-align:center; }
  img.preview { max-width:100%; border-radius:16px; margin-bottom:24px; display:block; }
  h1 { font-size:20px; margin:0 0 8px; }
  p { opacity:0.75; font-size:14px; line-height:1.5; margin:0; }
  a.button { display:inline-block; margin-top:24px; padding:12px 32px; border-radius:999px;
    background:#008e2a; color:#fff; text-decoration:none; font-weight:600; font-size:15px; }
</style>${redirectScript}
</head>
<body>
  <div class="card">
    <img class="preview" src="${imageUrl}" alt="${safeTitle}" width="1200" height="630" />
    <h1>${safeTitle}</h1>
    <p>${safeDescription}</p>
    <a class="button" href="${appDeepLink}">Open in Bounty</a>
  </div>
</body>
</html>`;
}

export function notFoundOgPage(kind: 'bounty' | 'profile', imageUrl: string, siteName = 'Bounty'): string {
  const title = kind === 'bounty' ? 'Bounty not found' : 'Profile not found';
  const description =
    kind === 'bounty'
      ? 'This bounty may have been removed or completed.'
      : 'This profile may no longer be available.';
  return renderOgPage({
    title,
    description,
    imageUrl,
    canonicalUrl: `https://bountyfinder.app/${kind}`,
    appDeepLink: 'bountyexpo-workspace://',
    siteName,
  });
}
