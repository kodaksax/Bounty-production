import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PortfolioItem } from '../types';
import { MAX_PORTFOLIO_ITEMS, portfolioService } from './portfolio-service';

/**
 * One-time client-side migration from the old AsyncStorage-only portfolio
 * (a single JSON blob at LEGACY_STORAGE_KEY, keyed by userId) into the new
 * server-backed `portfolio_items` table. The files these items point at are
 * already durably hosted in Supabase Storage (the old implementation only
 * ever kept the metadata/ordering local) -- see
 * lib/services/portfolio-service.ts's module comment -- so this registers
 * each item's existing remote URL server-side; it never re-uploads a binary.
 *
 * Never deletes the local AsyncStorage copy: if this fails partway (offline,
 * RLS hiccup, etc.) the device still has its own record and can retry later.
 */

const LEGACY_STORAGE_KEY = 'bountyexpo:portfolio_items_v1';
const MIGRATED_FLAG_PREFIX = 'bountyexpo:portfolio_migrated:';

export async function migrateLegacyPortfolioItems(userId: string): Promise<void> {
  if (!userId) return;

  const flagKey = `${MIGRATED_FLAG_PREFIX}${userId}`;
  try {
    const alreadyMigrated = await AsyncStorage.getItem(flagKey);
    if (alreadyMigrated) return;

    const raw = await AsyncStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) {
      await AsyncStorage.setItem(flagKey, '1');
      return;
    }

    const parsed = JSON.parse(raw) as Record<string, PortfolioItem[]>;
    const legacyItems = parsed?.[userId];
    if (!Array.isArray(legacyItems) || legacyItems.length === 0) {
      await AsyncStorage.setItem(flagKey, '1');
      return;
    }

    // Don't stomp anything already registered server-side (e.g. this ran on
    // a second device after the first already migrated for this user).
    const existingCount = await portfolioService.getItemCount(userId);
    if (existingCount > 0) {
      await AsyncStorage.setItem(flagKey, '1');
      return;
    }

    const toMigrate = legacyItems.slice(0, MAX_PORTFOLIO_ITEMS);
    for (const legacyItem of toMigrate) {
      if (!legacyItem?.url) continue;
      try {
        await portfolioService.addItem({
          userId,
          type: legacyItem.type || 'image',
          url: legacyItem.url,
          thumbnail: legacyItem.thumbnail,
          title: legacyItem.title,
          description: legacyItem.description,
          name: legacyItem.name,
          mimeType: legacyItem.mimeType,
          sizeBytes: legacyItem.sizeBytes,
        });
      } catch (e) {
        // A single bad legacy row (missing url, hit the limit mid-loop)
        // shouldn't abort the rest of the migration.
        console.error('[portfolio-legacy-migration] failed to migrate item', e);
      }
    }

    await AsyncStorage.setItem(flagKey, '1');
  } catch (e) {
    console.error('[portfolio-legacy-migration] migration failed, will retry next load', e);
    // Deliberately does not set the flag -- retry on the next app open.
  }
}
