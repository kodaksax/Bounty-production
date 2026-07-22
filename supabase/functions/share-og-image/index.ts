// Supabase Edge Function: share-og-image
//
// Renders a branded 1200x630 PNG (the standard Open Graph/Twitter Card
// "summary_large_image" size) for a bounty or profile, referenced as
// og:image/twitter:image by share-bounty/share-profile.
//
// Route: GET /share-og-image?type=bounty|profile&id=<uuid>&v=<cache-buster>
//   id=_fallback renders a generic branded card with no DB lookup at all —
//   used by share-bounty/share-profile for their 404 case, so a missing
//   record can never cascade into a broken image too.
//
// Rendering has two tiers:
//   1. Primary: hand-built SVG (title/reward/stats + optional embedded
//      photo/avatar fetched and inlined as a base64 data URI, since the
//      rasterizer does not fetch remote image refs) rasterized to PNG via
//      @resvg/resvg-wasm.
//   2. Fallback: if anything in tier 1 throws (bad data, wasm init
//      failure, image fetch timeout, ...), a solid brand-green PNG is
//      generated with zero external dependencies (_shared/simple-png.ts)
//      so the response is always a valid image, never an error page.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { Resvg, initWasm } from 'npm:@resvg/resvg-wasm@2.6.2';
import { escapeHtml } from '../_shared/og-html.ts';
import { encodeSolidColorPng } from '../_shared/simple-png.ts';

const WIDTH = 1200;
const HEIGHT = 630;
const BRAND_GREEN = '#008e2a';
const BG_DARK = '#0B0F14';
const BG_DARK_2 = '#111827';

const IMAGE_FETCH_TIMEOUT_MS = 2500;

let wasmInit: Promise<void> | null = null;
async function ensureWasmInitialized(): Promise<void> {
  if (!wasmInit) {
    wasmInit = (async () => {
      const wasmResp = await fetch('https://unpkg.com/@resvg/resvg-wasm@2.6.2/index_bg.wasm');
      await initWasm(await wasmResp.arrayBuffer());
    })();
  }
  return wasmInit;
}

function wrapText(text: string, maxCharsPerLine: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxCharsPerLine && current) {
      lines.push(current);
      current = word;
      if (lines.length === maxLines) break;
    } else {
      current = candidate;
    }
  }
  if (lines.length < maxLines && current) lines.push(current);
  if (lines.length === maxLines) {
    const last = lines[maxLines - 1];
    lines[maxLines - 1] = last.length > maxCharsPerLine - 1 ? `${last.slice(0, maxCharsPerLine - 1).trimEnd()}...` : last;
  }
  return lines;
}

async function fetchImageAsDataUri(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS);
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!resp.ok) return null;
    const contentType = resp.headers.get('content-type') || 'image/jpeg';
    const buffer = await resp.arrayBuffer();
    // Keep the OG image request itself fast — don't inline anything huge.
    if (buffer.byteLength > 3_000_000) return null;
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const base64 = btoa(binary);
    return `data:${contentType};base64,${base64}`;
  } catch {
    return null;
  }
}

function resolveStorageUrl(supabaseUrl: string, bucket: string, pathOrUrl: string | null | undefined): string | null {
  if (!pathOrUrl) return null;
  if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) return pathOrUrl;
  return `${supabaseUrl}/storage/v1/object/public/${bucket}/${pathOrUrl}`;
}

function firstImageAttachmentUrl(supabaseUrl: string, attachmentsJson: string | null | undefined): string | null {
  if (!attachmentsJson) return null;
  try {
    const attachments = JSON.parse(attachmentsJson) as Array<{
      remoteUri?: string;
      mimeType?: string;
      name?: string;
    }>;
    const image = attachments.find(
      (a) => a.mimeType?.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp)$/i.test(a.name || '')
    );
    return resolveStorageUrl(supabaseUrl, 'attachments', image?.remoteUri);
  } catch {
    return null;
  }
}

function baseSvgOpen(): string {
  return `<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${BG_DARK_2}" />
      <stop offset="100%" stop-color="${BG_DARK}" />
    </linearGradient>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)" />
  <rect x="0" y="0" width="10" height="${HEIGHT}" fill="${BRAND_GREEN}" />
  <text x="64" y="72" font-family="Arial, sans-serif" font-size="28" font-weight="700" fill="${BRAND_GREEN}" letter-spacing="2">BOUNTY</text>`;
}

function buildBountySvg(params: {
  title: string;
  rewardLine: string;
  detailLine: string;
  posterLine: string;
  photoDataUri: string | null;
}): string {
  const { title, rewardLine, detailLine, posterLine, photoDataUri } = params;
  const hasPhoto = Boolean(photoDataUri);
  const textX = 64;
  const titleLines = wrapText(title, hasPhoto ? 22 : 34, 2);

  const photoBlock = hasPhoto
    ? `<clipPath id="photoClip"><rect x="720" y="0" width="${WIDTH - 720}" height="${HEIGHT}" /></clipPath>
       <image href="${photoDataUri}" x="720" y="0" width="${WIDTH - 720}" height="${HEIGHT}" preserveAspectRatio="xMidYMid slice" clip-path="url(#photoClip)" />
       <rect x="700" y="0" width="20" height="${HEIGHT}" fill="url(#bg)" opacity="0.6" />`
    : '';

  const titleTspans = titleLines
    .map((line, i) => `<tspan x="${textX}" dy="${i === 0 ? 0 : 56}">${escapeHtml(line)}</tspan>`)
    .join('');

  return `${baseSvgOpen()}
  ${photoBlock}
  <text x="${textX}" y="220" font-family="Arial, sans-serif" font-size="64" font-weight="800" fill="#ffffff">${escapeHtml(rewardLine)}</text>
  <text x="${textX}" y="${300}" font-family="Arial, sans-serif" font-size="46" font-weight="700" fill="#ffffff">${titleTspans}</text>
  ${detailLine ? `<text x="${textX}" y="440" font-family="Arial, sans-serif" font-size="26" fill="#9CA3AF">${escapeHtml(detailLine)}</text>` : ''}
  ${posterLine ? `<text x="${textX}" y="480" font-family="Arial, sans-serif" font-size="24" fill="#9CA3AF">${escapeHtml(posterLine)}</text>` : ''}
  <text x="${textX}" y="${HEIGHT - 48}" font-family="Arial, sans-serif" font-size="22" fill="#4B5563">bountyfinder.app</text>
</svg>`;
}

function buildProfileSvg(params: {
  displayName: string;
  username: string;
  statLine: string;
  avatarDataUri: string | null;
}): string {
  const { displayName, username, statLine, avatarDataUri } = params;
  const textX = avatarDataUri ? 340 : 64;

  const avatarBlock = avatarDataUri
    ? `<clipPath id="avatarClip"><circle cx="180" cy="${HEIGHT / 2}" r="120" /></clipPath>
       <image href="${avatarDataUri}" x="60" y="${HEIGHT / 2 - 120}" width="240" height="240" preserveAspectRatio="xMidYMid slice" clip-path="url(#avatarClip)" />
       <circle cx="180" cy="${HEIGHT / 2}" r="120" fill="none" stroke="${BRAND_GREEN}" stroke-width="4" />`
    : `<circle cx="180" cy="${HEIGHT / 2}" r="120" fill="#1F2937" />
       <text x="180" y="${HEIGHT / 2 + 24}" font-family="Arial, sans-serif" font-size="80" font-weight="700" fill="${BRAND_GREEN}" text-anchor="middle">${escapeHtml(
        (displayName || username || '?').charAt(0).toUpperCase()
      )}</text>`;

  return `${baseSvgOpen()}
  ${avatarBlock}
  <text x="${textX}" y="300" font-family="Arial, sans-serif" font-size="52" font-weight="800" fill="#ffffff">${escapeHtml(displayName)}</text>
  ${username ? `<text x="${textX}" y="344" font-family="Arial, sans-serif" font-size="28" fill="#9CA3AF">@${escapeHtml(username)}</text>` : ''}
  ${statLine ? `<text x="${textX}" y="392" font-family="Arial, sans-serif" font-size="26" fill="${BRAND_GREEN}">${escapeHtml(statLine)}</text>` : ''}
  <text x="${textX}" y="${HEIGHT - 48}" font-family="Arial, sans-serif" font-size="22" fill="#4B5563">bountyfinder.app</text>
</svg>`;
}

function buildFallbackSvg(kind: 'bounty' | 'profile'): string {
  return `${baseSvgOpen()}
  <text x="64" y="300" font-family="Arial, sans-serif" font-size="48" font-weight="800" fill="#ffffff">${
    kind === 'bounty' ? 'Find work worth doing' : 'Join Bounty'
  }</text>
  <text x="64" y="${HEIGHT - 48}" font-family="Arial, sans-serif" font-size="22" fill="#4B5563">bountyfinder.app</text>
</svg>`;
}

async function svgToPng(svg: string): Promise<Uint8Array> {
  await ensureWasmInitialized();
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: WIDTH },
    font: { loadSystemFonts: true },
  });
  const rendered = resvg.render();
  return rendered.asPng();
}

function pngResponse(bytes: Uint8Array, cacheSeconds: number): Response {
  return new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': `public, max-age=${cacheSeconds}, s-maxage=${cacheSeconds * 10}, immutable`,
    },
  });
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const type = url.searchParams.get('type');
  const id = url.searchParams.get('id');

  if ((type !== 'bounty' && type !== 'profile') || !id) {
    return new Response('Missing or invalid type/id', { status: 400 });
  }

  try {
    if (id === '_fallback') {
      const png = await svgToPng(buildFallbackSvg(type));
      return pngResponse(png, 3600);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) throw new Error('Missing Supabase env vars');
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

    if (type === 'bounty') {
      const { data: bounty } = await supabaseAdmin
        .from('bounties')
        .select('title, amount, is_for_honor, category, location, username, attachments_json')
        .eq('id', id)
        .maybeSingle();

      if (!bounty) {
        const png = await svgToPng(buildFallbackSvg('bounty'));
        return pngResponse(png, 300);
      }

      const rewardLine = bounty.is_for_honor ? 'For Honor' : `$${Number(bounty.amount).toLocaleString()}`;
      const detailLine = [bounty.category, bounty.location].filter(Boolean).join(' • ');
      const posterLine = bounty.username ? `Posted by @${bounty.username}` : '';
      const photoDataUri = await fetchImageAsDataUri(firstImageAttachmentUrl(supabaseUrl, bounty.attachments_json));

      const png = await svgToPng(
        buildBountySvg({ title: bounty.title, rewardLine, detailLine, posterLine, photoDataUri })
      );
      return pngResponse(png, 600);
    }

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('username, display_name, avatar')
      .eq('id', id)
      .maybeSingle();

    if (!profile) {
      const png = await svgToPng(buildFallbackSvg('profile'));
      return pngResponse(png, 300);
    }

    const [{ data: ratingRows }, { count: completedCount }] = await Promise.all([
      supabaseAdmin.from('ratings').select('rating').eq('to_user_id', id),
      supabaseAdmin.from('bounties').select('id', { count: 'exact', head: true }).eq('accepted_by', id).eq('status', 'completed'),
    ]);
    const rows = ratingRows || [];
    const averageRating = rows.length
      ? rows.reduce((sum: number, r: any) => sum + Number(r.rating || 0), 0) / rows.length
      : 0;

    const statParts: string[] = [];
    if (averageRating > 0) statParts.push(`★ ${averageRating.toFixed(1)} (${rows.length})`);
    if ((completedCount || 0) > 0) statParts.push(`${completedCount} bounties completed`);

    const avatarDataUri = await fetchImageAsDataUri(
      resolveStorageUrl(supabaseUrl, 'Profilepictures', profile.avatar)
    );

    const png = await svgToPng(
      buildProfileSvg({
        displayName: profile.display_name || (profile.username ? `@${profile.username}` : 'Bounty user'),
        username: profile.username || '',
        statLine: statParts.join(' • '),
        avatarDataUri,
      })
    );
    return pngResponse(png, 600);
  } catch (err) {
    console.error('[share-og-image] falling back to solid-color PNG', err);
    const fallbackBytes = await encodeSolidColorPng(WIDTH, HEIGHT, [0x00, 0x8e, 0x2a]);
    return pngResponse(fallbackBytes, 60);
  }
});
