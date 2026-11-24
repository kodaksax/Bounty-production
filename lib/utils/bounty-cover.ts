/**
 * What a bounty looks like at a glance: the first photo its poster attached,
 * or its category's icon when there is none. Shared by the feed's featured
 * card and My Jobs.
 */
import type { MaterialIcons } from '@expo/vector-icons';
import { getBountyCategoryDef } from '../constants/bounty-categories';
import type { AttachmentMeta } from '../services/database.types';

/** First uploaded image the poster attached to a bounty, or null. */
export function getBountyCoverUri(attachmentsJson: string | null | undefined): string | null {
  if (!attachmentsJson) return null;
  try {
    const attachments = JSON.parse(attachmentsJson) as AttachmentMeta[];
    if (!Array.isArray(attachments)) return null;
    const found = attachments.find((a) => a?.remoteUri && a.mimeType?.startsWith('image/'));
    return found?.remoteUri ?? null;
  } catch {
    return null;
  }
}

/** Category glyph for a job with no photo; a neutral fallback otherwise. */
export function getBountyCategoryIcon(category: string | null | undefined): keyof typeof MaterialIcons.glyphMap {
  return (getBountyCategoryDef(category)?.icon as keyof typeof MaterialIcons.glyphMap | undefined) ?? 'work-outline';
}
