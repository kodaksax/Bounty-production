// lib/admin/bounty-attachments.ts — what a moderator can actually look at.
//
// `bounties.attachments_json` is a jsonb column, but the post flow writes a
// JSON *string* into it, so production rows are double-encoded
// ("[{\"id\":...}]"). Each entry also carries two URIs: `uri` is the poster's
// local device path (file:///var/mobile/..., useless to anyone else) and
// `remoteUri` is the public Storage URL. The admin console never parsed any of
// this, so photos attached to a listing were invisible to the people deciding
// whether to hide or remove it (GitHub #806).
import type { Attachment } from '../types';

export interface ParsedBountyAttachments {
  /** Attachments with a URL an admin's device can load. */
  viewable: Attachment[];
  /** Entries that never finished uploading (only a device-local uri). */
  unavailableCount: number;
}

const EMPTY: ParsedBountyAttachments = { viewable: [], unavailableCount: 0 };

function isRemoteUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https?:\/\//i.test(value);
}

function decode(raw: unknown): unknown[] {
  let value = raw;
  // Unwrap up to two layers of string encoding.
  for (let i = 0; i < 2 && typeof value === 'string'; i++) {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  return Array.isArray(value) ? value : [];
}

export function parseBountyAttachments(raw: unknown): ParsedBountyAttachments {
  if (raw == null) return EMPTY;
  const viewable: Attachment[] = [];
  let unavailableCount = 0;

  decode(raw).forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') return;
    const item = entry as Record<string, unknown>;
    const remote = isRemoteUrl(item.remoteUri) ? item.remoteUri : isRemoteUrl(item.uri) ? item.uri : null;
    if (!remote) {
      unavailableCount += 1;
      return;
    }
    const mime =
      typeof item.mimeType === 'string' ? item.mimeType : typeof item.mime === 'string' ? item.mime : undefined;
    viewable.push({
      id: typeof item.id === 'string' ? item.id : `attachment-${index}`,
      name: typeof item.name === 'string' && item.name ? item.name : `Attachment ${index + 1}`,
      uri: remote,
      remoteUri: remote,
      mimeType: mime,
      mime,
      size: typeof item.size === 'number' ? item.size : undefined,
      status: 'uploaded',
    });
  });

  return { viewable, unavailableCount };
}

export function isImageAttachment(attachment: Attachment): boolean {
  const mime = attachment.mimeType || attachment.mime;
  if (mime) return mime.startsWith('image/');
  return /\.(png|jpe?g|gif|webp|heic|heif)$/i.test(attachment.name || attachment.uri);
}
