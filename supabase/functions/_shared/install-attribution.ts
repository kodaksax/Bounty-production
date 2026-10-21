// Install attribution: which click (if any) produced a signup, and how sure we are.
//
// Shared by app-link (writes the click) and marketing-attribute (claims it for a
// user). Dependency-free so the matching rules are unit-tested directly
// (__tests__/unit/install-attribution.test.ts).
//
// Confidence is a statement about the evidence, not a tuning knob:
//   1.0  the click id itself came back through the store (Play Install Referrer,
//        the iOS clipboard handoff) or the signup happened in the browser that
//        clicked. Nothing is inferred.
//   <0.9 anything inferred from IP + OS + time. These rows are kept (they are
//        still a lead) but `marketing_attribution.attribution_reportable` is
//        false for them, so no report or campaign total counts them, and the
//        PostHog person is never merged on them.

export const REPORTABLE_CONFIDENCE = 0.9;

/** How far back a probabilistic match may look for a click. */
export const FINGERPRINT_WINDOW_HOURS = 24;

export type DeviceOs = 'ios' | 'android' | 'web';

export type MatchMethod =
  | 'play_referrer'
  | 'clipboard_handoff'
  | 'web_session'
  | 'branch_deferred_link'
  | 'fingerprint'
  | 'unattributed';

export interface Utm {
  source?: string;
  medium?: string;
  campaign?: string;
  content?: string;
  term?: string;
}

export interface ParsedReferrer {
  utm: Utm;
  clickId: string | null;
  referrer?: string;
}

export interface ClickCandidate {
  click_id: string;
  clicked_at: string;
}

export interface ResolvedMatch {
  method: MatchMethod;
  confidence: number;
  clickId: string | null;
  /** UTMs carried by the signal itself; a claimed click's own row overrides these. */
  utm: Utm;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function asUuid(value: unknown): string | null {
  return typeof value === 'string' && UUID_RE.test(value.trim()) ? value.trim().toLowerCase() : null;
}

/** Trimmed, length-capped string, or undefined for empty / Play's "(not set)". */
export function cleanText(value: unknown, maxLength = 200): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed === '(not set)' || trimmed === '(not%20set)') return undefined;
  return trimmed.slice(0, maxLength);
}

/**
 * PostHog distinct ids from posthog-js are UUIDs (v7) today; older ones were
 * longer opaque strings. Accept the safe character set only, so a crafted value
 * can never smuggle anything into a capture payload.
 */
export function cleanDistinctId(value: unknown): string | undefined {
  const text = cleanText(value, 200);
  return text && /^[A-Za-z0-9._:@-]+$/.test(text) ? text : undefined;
}

/**
 * Parses the raw Play Install Referrer string. Google returns it verbatim, so
 * a click from app-link arrives as
 * `utm_source=...&utm_medium=...&utm_campaign=...&click_id=<uuid>`, and an
 * organic Play Store install as `utm_source=google-play&utm_medium=organic`.
 */
export function parseInstallReferrer(raw: unknown): ParsedReferrer | null {
  const text = cleanText(raw, 4000);
  if (!text) return null;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(text);
  } catch {
    return null;
  }
  const utm: Utm = {
    source: cleanText(params.get('utm_source')),
    medium: cleanText(params.get('utm_medium')),
    campaign: cleanText(params.get('utm_campaign')),
    content: cleanText(params.get('utm_content')),
    term: cleanText(params.get('utm_term')),
  };
  const clickId = asUuid(params.get('click_id'));
  const referrer = cleanText(params.get('referrer'), 1000);
  if (!clickId && !utm.source && !utm.campaign) return null;
  return { utm, clickId, ...(referrer ? { referrer } : {}) };
}

export function deviceFromUserAgent(userAgent: string | null | undefined): string {
  const ua = (userAgent ?? '').toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return 'ios';
  if (/android/.test(ua)) return 'android';
  if (/windows|macintosh|linux|cros/.test(ua)) return 'desktop';
  return 'other';
}

/** First hop of x-forwarded-for: the client as the edge saw it. */
export function clientIp(forwardedFor: string | null | undefined): string | null {
  const first = (forwardedFor ?? '').split(',')[0]?.trim();
  return first ? first : null;
}

/**
 * Daily-rotating IP hash input, identical to the `go` redirector's
 * (`${ip}|${salt}|${yyyy-mm-dd}`), so clicks from either redirector match.
 */
export function ipHashInput(ip: string, salt: string, day: string): string {
  return `${ip}|${salt}|${day}`;
}

/** The UTC days a click inside the fingerprint window could have been hashed on. */
export function fingerprintDays(now: Date): string[] {
  const today = now.toISOString().slice(0, 10);
  const yesterday = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
  return [today, yesterday];
}

/**
 * Confidence for an IP + OS + time match. Deliberately never reaches the
 * reportable bar: a shared IP (carrier NAT, office wifi) makes two people
 * indistinguishable, and nothing here can rule that out.
 */
export function fingerprintConfidence(candidates: ClickCandidate[], now: Date): number | null {
  if (candidates.length === 0) return null;
  if (candidates.length > 1) return 0.3;
  const ageMs = now.getTime() - new Date(candidates[0].clicked_at).getTime();
  if (ageMs < 0 || ageMs > FINGERPRINT_WINDOW_HOURS * 3_600_000) return null;
  return ageMs <= 3_600_000 ? 0.7 : 0.5;
}

export interface MatchInput {
  os: DeviceOs;
  referrer: ParsedReferrer | null;
  /** A click id the device recovered itself (iOS clipboard) or the browser held (web). */
  handoffClickId: string | null;
  /** The handoff click id exists in marketing_clicks. */
  handoffClickExists: boolean;
  /** The referrer's click id exists in marketing_clicks. */
  referrerClickExists: boolean;
  webUtm: Utm | null;
  branch: { utm: Utm; guaranteed: boolean } | null;
  fingerprintCandidates: ClickCandidate[];
  now: Date;
}

/**
 * Picks the strongest evidence available. Order matters: a click id that came
 * back through the store beats anything the device or browser says about
 * itself, which beats an inference.
 */
export function resolveInstallMatch(input: MatchInput): ResolvedMatch {
  const { referrer } = input;

  if (input.os === 'android' && referrer) {
    return {
      method: 'play_referrer',
      confidence: 1,
      clickId: referrer.clickId && input.referrerClickExists ? referrer.clickId : null,
      utm: referrer.utm,
    };
  }

  if (input.os === 'ios' && input.handoffClickId && input.handoffClickExists) {
    return { method: 'clipboard_handoff', confidence: 1, clickId: input.handoffClickId, utm: {} };
  }

  if (input.os === 'web') {
    if (input.handoffClickId && input.handoffClickExists) {
      return { method: 'web_session', confidence: 1, clickId: input.handoffClickId, utm: {} };
    }
    if (input.webUtm) {
      return { method: 'web_session', confidence: 1, clickId: null, utm: input.webUtm };
    }
  }

  if (input.branch) {
    return {
      method: 'branch_deferred_link',
      confidence: input.branch.guaranteed ? 1 : 0.6,
      clickId: null,
      utm: input.branch.utm,
    };
  }

  const confidence = fingerprintConfidence(input.fingerprintCandidates, input.now);
  if (confidence != null) {
    return {
      method: 'fingerprint',
      confidence,
      // Multiple candidates: keep the newest as the lead, at low confidence.
      clickId: input.fingerprintCandidates[0].click_id,
      utm: {},
    };
  }

  return { method: 'unattributed', confidence: 0, clickId: null, utm: {} };
}

export function isReportable(match: Pick<ResolvedMatch, 'method' | 'confidence'>): boolean {
  return match.method === 'unattributed' || match.confidence >= REPORTABLE_CONFIDENCE;
}

/** The text the website copies on an iPhone App Store tap, and the app parses back. */
export const HANDOFF_URL_PREFIX = 'https://www.bountyfinder.net/?install=';

export function parseHandoffText(text: unknown): string | null {
  const value = cleanText(text, 500);
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!/(^|\.)bountyfinder\.net$/.test(url.hostname)) return null;
    return asUuid(url.searchParams.get('install'));
  } catch {
    return null;
  }
}
