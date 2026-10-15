import { Alert, Platform, Share } from 'react-native';
import { analyticsService } from '../services/analytics-service';

// Production domain for shareable links. Each link is served by a Supabase
// Edge Function (supabase/functions/share-bounty, share-profile) that
// returns an Open Graph/Twitter Card-tagged HTML page for link-unfurling
// bots, and a smart redirect (custom-scheme deep link -> App/Play Store
// fallback) for real browsers. Path is singular (`/bounty/:id`,
// `/profile/:id`) to match the app's own routes (app/bounty/[id]/index.tsx,
// app/profile/[userId].tsx) and the .well-known AASA/assetlinks path config.
const APP_SCHEME = 'https://bountyfinder.app';

const DESCRIPTION_TRUNCATE_LENGTH = 140;

function truncate(text: string | undefined | null, length: number): string {
    if (!text) return '';
    const trimmed = text.trim();
    if (trimmed.length <= length) return trimmed;
    return `${trimmed.slice(0, length).trimEnd()}...`;
}

interface ShareBountyOptions {
    id: string | number;
    title: string;
    /** Reward amount in dollars. Ignored when isForHonor is true. */
    amount: number;
    isForHonor?: boolean;
    description?: string;
    category?: string;
    location?: string;
    posterName?: string;
    surface?: 'bounty_detail' | 'post_publish';
}

interface ShareProfileOptions {
    id: string;
    name?: string;
    username?: string;
    about?: string;
    averageRating?: number;
    ratingCount?: number;
    completedCount?: number;
}

type ShareOutcome = 'completed' | 'cancelled' | 'presented' | 'link_copied' | 'link_displayed';

async function presentShare(params: {
    contentType: 'bounty' | 'profile';
    contentId: string | number;
    url: string;
    message: string;
    title: string;
    dialogTitle: string;
    surface: string;
}): Promise<ShareOutcome> {
    const { contentType, contentId, url, message, title, dialogTitle, surface } = params;
    const properties = { content_type: contentType, content_id: String(contentId), surface };

    if (Platform.OS === 'web') {
        if (typeof navigator !== 'undefined' && navigator.clipboard) {
            await navigator.clipboard.writeText(url);
            Alert.alert('Link Copied', 'Link copied to clipboard!');
        } else {
            Alert.alert('Share Link', url);
            return 'link_displayed';
        }
        analyticsService.trackEvent('share_link_copied', properties);
        return 'link_copied';
    }

    const result = await Share.share(
        {
            message,
            title,
            // iOS surfaces `url` as a distinct shareable attachment alongside the
            // message; Android's Share intent has no separate url field and
            // ignores it, so the link must already be embedded in `message`.
            url: Platform.OS === 'ios' ? url : undefined,
        },
        {
            subject: title,
            dialogTitle,
        }
    );

    // Android's share sheet resolves as soon as the chooser is presented, not
    // when the user actually picks an app, so `dismissedAction` (iOS-only)
    // is the only reliable cancellation signal available from this API.
    if (result.action === Share.dismissedAction) {
        analyticsService.trackEvent('share_cancelled', properties);
        return 'cancelled';
    }

    if (Platform.OS !== 'ios' || result.action !== Share.sharedAction) {
        analyticsService.trackEvent('share_presented', properties);
        return 'presented';
    }

    analyticsService.trackEvent('share_completed', {
        ...properties,
        completion_scope: 'native_activity',
        activity_type: (result as { activityType?: string }).activityType,
    });
    return 'completed';
}

/**
 * Share a bounty link without syndicating authenticated marketplace data.
 */
export const shareBounty = async ({
    id,
    surface = 'bounty_detail',
}: ShareBountyOptions) => {
    try {
        const url = `${APP_SCHEME}/bounty/${encodeURIComponent(String(id))}`;
        const title = 'Get help with Bounty';
        // Titles, descriptions and attachments can themselves contain personal
        // data. Share only a link until a consented public projection exists.
        const lines = [
            'A task worth getting done. A community ready to help.',
            'View this bounty in Bounty, or post a task of your own.',
            url,
        ];

        analyticsService.trackEvent('bounty_shared', {
            content_id: String(id),
            content_type: 'bounty',
            surface,
        });

        return await presentShare({
            contentType: 'bounty',
            contentId: id,
            url,
            message: lines.join('\n\n'),
            title,
            dialogTitle: `Share ${title}`,
            surface,
        });
    } catch (error) {
        console.error('Error sharing bounty:', error);
        Alert.alert('Unable to share', 'Please try sharing your bounty again.');
        return undefined;
    }
};

/**
 * Share a user profile with a rich message and a deep link to its public share page.
 */
export const shareProfile = async ({
    id,
    name,
    username,
    about,
    averageRating,
    ratingCount,
    completedCount,
}: ShareProfileOptions) => {
    try {
        const url = `${APP_SCHEME}/profile/${id}`;
        const displayName = name || (username ? `@${username}` : 'this user');

        const statParts: string[] = [];
        if (typeof averageRating === 'number' && averageRating > 0) {
            const ratingSuffix = typeof ratingCount === 'number' ? ` (${ratingCount})` : '';
            statParts.push(`⭐ ${averageRating.toFixed(1)}${ratingSuffix}`);
        }
        if (typeof completedCount === 'number' && completedCount > 0) {
            statParts.push(`${completedCount} bounties completed`);
        }
        const statLine = statParts.join(' • ');

        const lines = [`Check out ${displayName} on Bounty!`];
        if (statLine) lines.push(statLine);
        const truncatedAbout = truncate(about, DESCRIPTION_TRUNCATE_LENGTH);
        if (truncatedAbout) lines.push(truncatedAbout);
        lines.push(url);

        analyticsService.trackEvent('profile_shared', {
            content_id: String(id),
            content_type: 'profile',
            surface: 'profile',
            has_rating: typeof averageRating === 'number',
        });

        return await presentShare({
            contentType: 'profile',
            contentId: id,
            url,
            message: lines.join('\n\n'),
            title: `${displayName} on Bounty`,
            dialogTitle: `Share ${displayName}'s Profile`,
            surface: 'profile',
        });
    } catch (error) {
        console.error('Error sharing profile:', error);
        return undefined;
    }
};
