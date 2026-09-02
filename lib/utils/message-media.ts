/**
 * Helpers for message attachments (chat media).
 *
 * Messages only persist a `media_url` string, so the attachment kind has to be
 * inferred from the URL. Keep this logic in one place so the composer, the
 * message bubble, the viewer and the conversation list all agree.
 */

export type MediaKind = 'image' | 'video' | 'file';

const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'bmp'];
const VIDEO_EXTENSIONS = ['mp4', 'mov', 'm4v', 'webm', 'avi', '3gp'];

const EXTENSION_MIME_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  bmp: 'image/bmp',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  m4v: 'video/x-m4v',
  webm: 'video/webm',
  avi: 'video/x-msvideo',
  '3gp': 'video/3gpp',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
};

/**
 * Strip the query string / fragment and return the last path segment of a URL.
 * Returns '' for empty input.
 */
export function mediaFileName(url: string | null | undefined): string {
  if (!url) return '';
  const withoutQuery = url.split('?')[0].split('#')[0];
  const segment = withoutQuery.split('/').pop() || '';
  try {
    return decodeURIComponent(segment) || 'Attachment';
  } catch {
    return segment || 'Attachment';
  }
}

/** Lowercased file extension of a media URL, or '' when there isn't one. */
export function mediaExtension(url: string | null | undefined): string {
  const name = mediaFileName(url);
  if (!name.includes('.')) return '';
  return (name.split('.').pop() || '').toLowerCase();
}

/**
 * Classify a media URL. Data URIs carry their own mime type; everything else is
 * classified by extension, defaulting to 'file' for unknown types.
 */
export function getMediaKind(url: string | null | undefined): MediaKind {
  if (!url) return 'file';

  if (url.startsWith('data:')) {
    if (url.startsWith('data:image/')) return 'image';
    if (url.startsWith('data:video/')) return 'video';
    return 'file';
  }

  const ext = mediaExtension(url);
  if (IMAGE_EXTENSIONS.includes(ext)) return 'image';
  if (VIDEO_EXTENSIONS.includes(ext)) return 'video';
  return 'file';
}

/** Best-effort mime type for a media URL, used by the attachment viewer. */
export function getMediaMimeType(url: string | null | undefined): string {
  if (!url) return 'application/octet-stream';
  if (url.startsWith('data:')) {
    const match = url.match(/^data:([^;,]+)/);
    if (match) return match[1];
  }
  return EXTENSION_MIME_TYPES[mediaExtension(url)] || 'application/octet-stream';
}

/**
 * Short label for a message that only carries an attachment — used for
 * conversation list previews and push notifications, where an empty string
 * would otherwise render as a blank row.
 */
export function mediaPreviewLabel(url: string | null | undefined): string {
  switch (getMediaKind(url)) {
    case 'image':
      return '📷 Photo';
    case 'video':
      return '🎥 Video';
    default:
      return '📎 Attachment';
  }
}

// Emoji detection. Written with explicit surrogate ranges (rather than the
// `u`-flag `\p{Emoji}` property) so the pattern compiles on every JS engine
// Hermes ships with. The classes cover:
//   - surrogate pairs (most emoji, incl. skin tones and regional indicators)
//   - BMP symbol blocks: arrows/misc-technical (U+2190-U+2BFF), misc symbols
//     and dingbats (U+2600-U+27BF), plus the stragglers U+3030, U+303D,
//     U+3297, U+3299, (c), (r) and (tm)
//   - modifiers: variation selectors, ZWJ, combining enclosing keycap
//   - keycap bases (0-9, #, *) only when followed by a keycap combiner
const EMOJI_CHAR_CLASS =
  '[\\uD800-\\uDBFF][\\uDC00-\\uDFFF]' +
  '|[\\u2190-\\u2BFF\\u2600-\\u27BF\\u3030\\u303D\\u3297\\u3299\\u00A9\\u00AE\\u2122]' +
  '|[\\uFE0E\\uFE0F\\u200D\\u20E3]' +
  '|[0-9#*](?=[\\uFE0F]?\\u20E3)';

const EMOJI_ONLY_RE = new RegExp('^(?:' + EMOJI_CHAR_CLASS + '|\\s)+$');

// At least one "real" emoji character must be present, so a string of bare
// whitespace, variation selectors or ASCII digits doesn't qualify. Keycap
// sequences (1 + U+FE0F + U+20E3) count via the trailing combiner.
const HAS_EMOJI_RE = new RegExp(
  '[\\uD800-\\uDBFF][\\uDC00-\\uDFFF]' +
  '|[\\u2190-\\u2BFF\\u2600-\\u27BF\\u3030\\u303D\\u3297\\u3299\\u00A9\\u00AE\\u2122\\u20E3]'
);

/**
 * True when `text` is made up only of emoji (and whitespace), so the bubble can
 * render it at a larger size. Returns false for empty/whitespace-only strings
 * and for anything containing letters, digits or punctuation.
 */
export function isEmojiOnly(text: string | null | undefined): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  // Cap the length so a long paste can't turn into 44pt text.
  if (Array.from(trimmed).length > 24) return false;
  return EMOJI_ONLY_RE.test(trimmed) && HAS_EMOJI_RE.test(trimmed);
}
