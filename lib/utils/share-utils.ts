import { Alert, Platform, Share } from 'react-native';

const APP_SCHEME = 'https://bountyfinder.app'; // Production URL scheme

interface ShareBountyOptions {
    title: string;
    price: number;
    id: string | number;
    description?: string;
}

interface ShareProfileOptions {
    name?: string;
    username?: string;
    id: string;
    about?: string;
}

/**
 * Share a bounty with a deep link
 */
export const shareBounty = async ({ title, price, id, description }: ShareBountyOptions) => {
    try {
        const url = `${APP_SCHEME}/bounties/${id}`;
        const message = `Check out this bounty on BountyExpo!\n\n${title}\nPrice: $${price}\n\n${description ? description.substring(0, 100) + (description.length > 100 ? '...' : '') + '\n\n' : ''}View details: ${url}`;

        if (Platform.OS === 'web') {
            if (typeof navigator !== 'undefined' && navigator.clipboard) {
                await navigator.clipboard.writeText(url);
                Alert.alert('Link Copied', 'Bounty link copied to clipboard!');
            } else {
                Alert.alert('Share Link', url);
            }
        } else {
            await Share.share({
                message, // iOS: message + url usually works best, or url in url param
                title: title,
                url: Platform.OS === 'ios' ? url : undefined, // Android often ignores 'url' param and expects it in message
            }, {
                subject: `Bounty: ${title}`, // iOS specific
                dialogTitle: `Share ${title}`, // Android specific
            });
        }
    } catch (error) {
        console.error('Error sharing bounty:', error);
    }
};

/**
 * Share a user profile with a deep link
 */
export const shareProfile = async ({ name, username, id, about }: ShareProfileOptions) => {
    try {
        const url = `${APP_SCHEME}/profile/${id}`;
        const displayName = name || username || 'User';
        const message = `Check out ${displayName}'s profile on BountyExpo!\n\n${about ? about.substring(0, 100) + (about.length > 100 ? '...' : '') + '\n\n' : ''}View profile: ${url}`;

        if (Platform.OS === 'web') {
            if (typeof navigator !== 'undefined' && navigator.clipboard) {
                await navigator.clipboard.writeText(url);
                Alert.alert('Link Copied', 'Profile link copied to clipboard!');
            } else {
                Alert.alert('Share Link', url);
            }
        } else {
            await Share.share({
                message,
                title: `Profile: ${displayName}`,
                url: Platform.OS === 'ios' ? url : undefined,
            }, {
                subject: `Profile: ${displayName}`,
                dialogTitle: `Share ${displayName}'s Profile`,
            });
        }
    } catch (error) {
        console.error('Error sharing profile:', error);
    }
};
