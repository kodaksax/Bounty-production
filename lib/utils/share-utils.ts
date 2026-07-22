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

type ShareOutcome = 'completed' | 'cancelled' | 'link_copied';

async function presentShare(params: {
    contentType: 'bounty' | 'profile';
    contentId: string | number;
    url: string;
    message: string;
    title: string;
    dialogTitle: string;
}): Promise<ShareOutcome> {
    const { contentType, contentId, url, message, title, dialogTitle } = params;

    if (Platform.OS === 'web') {
        if (typeof navigator !== 'undefined' && navigator.clipboard) {
            await navigator.clipboard.writeText(url);
            Alert.alert('Link Copied', 'Link copied to clipboard!');
        } else {
            Alert.alert('Share Link', url);
        }
        analyticsService.trackEvent('share_link_copied', {
            content_type: contentType,
            content_id: String(contentId),
        });
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
        analyticsService.trackEvent('share_cancelled', {
            content_type: contentType,
            content_id: String(contentId),
        });
        return 'cancelled';
    }

    analyticsService.trackEvent('share_completed', {
        content_type: contentType,
        content_id: String(contentId),
        activity_type: (result as { activityType?: string }).activityType,
    });
    return 'completed';
}

/**
 * Share a bounty with a rich message and a deep link to its public share page.
 */
export const shareBounty = async ({
    id,
    title,
    amount,
    isForHonor,
    description,
    category,
    location,
    posterName,
}: ShareBountyOptions) => {
    try {
        const url = `${APP_SCHEME}/bounty/${id}`;
        const rewardLine = isForHonor ? 'For Honor' : `$${amount.toLocaleString()} reward`;

        const detailParts = [category, location].filter(Boolean);
        const detailLine = detailParts.length > 0 ? detailParts.join(' • ') : '';

        const lines = [
            `Check out this bounty on Bounty: ${title}`,
            rewardLine,
        ];
        if (detailLine) lines.push(detailLine);
        const truncatedDescription = truncate(description, DESCRIPTION_TRUNCATE_LENGTH);
        if (truncatedDescription) lines.push(truncatedDescription);
        if (posterName) lines.push(`Posted by ${posterName}`);
        lines.push(url);

        analyticsService.trackEvent('bounty_shared', {
            content_id: String(id),
            has_description: Boolean(description),
            is_for_honor: Boolean(isForHonor),
        });

        return await presentShare({
            contentType: 'bounty',
            contentId: id,
            url,
            message: lines.join('\n\n'),
            title,
            dialogTitle: `Share ${title}`,
        });
    } catch (error) {
        console.error('Error sharing bounty:', error);
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
            has_rating: typeof averageRating === 'number',
        });

        return await presentShare({
            contentType: 'profile',
            contentId: id,
            url,
            message: lines.join('\n\n'),
            title: `${displayName} on Bounty`,
            dialogTitle: `Share ${displayName}'s Profile`,
        });
    } catch (error) {
        console.error('Error sharing profile:', error);
        return undefined;
    }
};
