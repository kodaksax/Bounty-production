import { MaterialIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import { ErrorBanner } from '../error-banner';
import { Skeleton } from '../ui/skeleton';
import { OnboardingProgressDots } from './OnboardingProgressDots';
import { getPreviewCards } from './previewBounties';
import { hapticFeedback } from '../../lib/haptic-feedback';
import type { UserFriendlyError } from '../../lib/utils/error-messages';
import type { Bounty } from '../../lib/services/database.types';
import type { OnboardingDetailsStyles } from '../../lib/onboarding/onboarding-details-styles';
import type { AppTheme } from '../../lib/themes/types';

type HunterSampleBountyScreenProps = {
  theme: AppTheme;
  styles: OnboardingDetailsStyles;
  insets: { top: number; bottom: number };
  recentBounties: Bounty[] | null;
  onNext: () => void;
  applying: boolean;
  onSkip: () => void;
  /** Requests notification permission; resolves true if granted. */
  onNotifyMe: () => Promise<boolean>;
  /** Switches the onboarding intent to 'poster' when there's nothing to hunt yet. */
  onSwitchToPoster: () => void;
  /** Which bucket `recentBounties` currently holds — drives the "no nearby, browse online" vs "confirmed empty market" empty state. */
  bountySource: 'nearby' | 'online' | null;
  /** Switches to online/remote bounties — the primary CTA on the "no nearby bounties" empty state. */
  onBrowseOnline: () => void;
  /** Re-requests location permission so a hunter who skipped/declined can opt back in later. */
  onUseLocation: () => void;
  /** True while a browse-online / retry fetch triggered from this screen is in flight. */
  isResolvingLocation: boolean;
  discoveryError: UserFriendlyError | null;
  onRetryDiscovery: () => void;
};

// Hunter branch, step 3 of 4: sign in -> location -> [this] -> done.
export function HunterSampleBountyScreen({
  theme,
  styles,
  insets,
  recentBounties,
  onNext,
  applying,
  onSkip,
  onNotifyMe,
  onSwitchToPoster,
  bountySource,
  onBrowseOnline,
  onUseLocation,
  isResolvingLocation,
  discoveryError,
  onRetryDiscovery,
}: HunterSampleBountyScreenProps) {
  const [notifyState, setNotifyState] = useState<'idle' | 'requesting' | 'granted' | 'denied'>('idle');

  const isLoading = recentBounties === null;
  const previewCards = getPreviewCards(recentBounties);
  const isEmpty = !isLoading && previewCards.length === 0;
  const sampleCard = previewCards[0];
  const sampleBounty = recentBounties && recentBounties.length > 0 ? recentBounties[0] : null;

  const bannerAmount =
    recentBounties && recentBounties.length > 0
      ? Math.max(...recentBounties.map((b) => b.amount))
      : null;

  const detailText = sampleBounty
    ? [
        sampleBounty.timeline,
        sampleBounty.location,
        sampleBounty.duration_minutes ? `${Math.round(sampleBounty.duration_minutes / 60)} hrs` : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : '';

  const handleNext = () => {
    hapticFeedback.light();
    onNext();
  };

  const handleNotifyMe = async () => {
    setNotifyState('requesting');
    const granted = await onNotifyMe();
    hapticFeedback[granted ? 'success' : 'light']();
    setNotifyState(granted ? 'granted' : 'denied');
  };

  const handleSwitchToPoster = () => {
    hapticFeedback.light();
    onSwitchToPoster();
  };

  if (isLoading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.hunterContent}>
          <OnboardingProgressDots total={4} activeIndex={2} style={{ marginTop: 16, marginBottom: 24 }} />
          <Skeleton style={{ height: 96, borderRadius: 16, marginBottom: 16 }} />
          <Skeleton style={{ height: 120, borderRadius: 16 }} />
        </View>
      </View>
    );
  }

  if (isEmpty) {
    // "nearby" came back with zero local results — there may still be
    // online/remote bounties, so lead with that CTA instead of only offering
    // to wait for a notification. A source of 'online' (or unset, e.g. the
    // hunter skipped location entirely) means we already looked everywhere,
    // so the notify-me copy below is the only honest option left.
    const noNearbyButOnlineAvailable = bountySource === 'nearby';

    return (
      <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.hunterContent}>
          <OnboardingProgressDots total={4} activeIndex={2} style={{ marginTop: 16, marginBottom: 24 }} />

          {discoveryError ? (
            <View style={styles.discoveryErrorWrapper}>
              <ErrorBanner error={discoveryError} onAction={onRetryDiscovery} />
            </View>
          ) : null}

          <View style={styles.hunterSpacer} />

          <View style={styles.emptyState}>
            <View style={styles.emptyStateIcon}>
              <MaterialIcons name="eco" size={36} color={theme.primary} />
            </View>
            <Text style={styles.emptyStateTitle} accessibilityRole="header">
              No nearby bounties yet
            </Text>
            <Text style={styles.emptyStateBody}>
              {noNearbyButOnlineAvailable
                ? 'New bounties are posted all the time — check back soon, or browse online bounties you can do from anywhere right now.'
                : "You’re early — that’s a good thing. We’ll notify you the moment one appears near you."}
            </Text>

            {noNearbyButOnlineAvailable ? (
              <TouchableOpacity
                style={[styles.locationButton, { backgroundColor: theme.primary, width: '100%' }]}
                onPress={onBrowseOnline}
                disabled={isResolvingLocation}
                accessibilityRole="button"
                accessibilityLabel="Browse online bounties"
                accessibilityState={{ disabled: isResolvingLocation, busy: isResolvingLocation }}
              >
                {isResolvingLocation ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <Text style={styles.locationButtonText}>Browse Online Bounties</Text>
                )}
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[styles.locationButton, { backgroundColor: theme.primary, width: '100%' }]}
                onPress={handleNotifyMe}
                disabled={notifyState === 'requesting' || notifyState === 'granted'}
                accessibilityRole="button"
                accessibilityLabel="Notify me when a bounty appears nearby"
                accessibilityState={{ disabled: notifyState === 'requesting' || notifyState === 'granted' }}
              >
                {notifyState === 'requesting' ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <Text style={styles.locationButtonText}>
                    {notifyState === 'granted'
                      ? "We'll notify you ✓"
                      : notifyState === 'denied'
                        ? 'Enable notifications in Settings'
                        : 'Notify me'}
                  </Text>
                )}
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.hunterSpacer} />

          {bountySource === 'online' ? (
            <TouchableOpacity
              style={styles.enableLocationLink}
              onPress={onUseLocation}
              disabled={isResolvingLocation}
              accessibilityRole="button"
              accessibilityLabel="Enable location to see bounties near you"
            >
              <Text style={styles.enableLocationLinkText}>Enable location for bounties near you</Text>
            </TouchableOpacity>
          ) : null}

          <TouchableOpacity
            style={styles.skipLink}
            onPress={handleSwitchToPoster}
            accessibilityRole="button"
            accessibilityLabel="Post a bounty instead"
          >
            <Text style={styles.skipLinkText}>Post a bounty instead</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.skipLink}
            onPress={onSkip}
            accessibilityRole="button"
            accessibilityLabel="Skip for now"
          >
            <Text style={styles.skipLinkText}>Skip for now</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.hunterContent}>
        <OnboardingProgressDots total={4} activeIndex={2} style={{ marginTop: 16, marginBottom: 8 }} />

        {discoveryError ? (
          <View style={styles.discoveryErrorWrapper}>
            <ErrorBanner error={discoveryError} onAction={onRetryDiscovery} />
          </View>
        ) : null}

        <View style={styles.earnBanner}>
          <Text style={styles.earnBannerText}>
            Earn up to <Text style={styles.earnBannerAmount}>${bannerAmount}</Text> nearby
          </Text>
        </View>

        <View style={styles.bountyCard}>
          <View style={styles.bountyCardTopRow}>
            <Text style={styles.sampleCardTitle} numberOfLines={1}>{sampleCard.title}</Text>
            <Text style={styles.sampleCardPrice}>{sampleCard.priceLabel}</Text>
          </View>
          <View style={styles.bountyCardMetaRow}>
            <Text style={styles.bountyCardMetaText}>{sampleCard.metaLabel}</Text>
          </View>
          <TouchableOpacity
            style={[styles.viewAcceptButton, { backgroundColor: theme.primary }]}
            onPress={handleNext}
            disabled={applying}
            accessibilityRole="button"
            accessibilityLabel="View and accept this bounty"
            accessibilityState={{ disabled: applying, busy: applying }}
          >
            {applying ? (
              <ActivityIndicator color="#ffffff" style={{ marginRight: 8 }} />
            ) : null}
            <Text style={styles.viewAcceptButtonText}>View &amp; accept</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.detailSheet}>
          <Text style={styles.detailSheetLabel}>DETAIL SHEET</Text>
          <Text style={styles.detailSheetText}>{detailText}</Text>
          <TouchableOpacity
            style={[styles.viewAcceptButton, { backgroundColor: theme.primary }]}
            onPress={handleNext}
            disabled={applying}
            accessibilityRole="button"
            accessibilityLabel="I can do this today"
            accessibilityState={{ disabled: applying, busy: applying }}
          >
            {applying ? (
              <ActivityIndicator color="#ffffff" style={{ marginRight: 8 }} />
            ) : null}
            <Text style={styles.viewAcceptButtonText}>
              {applying ? 'Applying…' : '✓ I can do this today'}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.hunterSpacer} />

        <Text style={styles.hunterFootnote}>
          Accepted bounty pins to top with next step (&ldquo;Sat 10am · get directions&rdquo;)
        </Text>

        {bountySource === 'online' ? (
          <TouchableOpacity
            style={styles.enableLocationLink}
            onPress={onUseLocation}
            disabled={isResolvingLocation}
            accessibilityRole="button"
            accessibilityLabel="Enable location to see bounties near you"
          >
            <Text style={styles.enableLocationLinkText}>Enable location for bounties near you</Text>
          </TouchableOpacity>
        ) : null}

        <TouchableOpacity
          style={styles.skipLink}
          onPress={onSkip}
          accessibilityRole="button"
          accessibilityLabel="Skip for now"
        >
          <Text style={styles.skipLinkText}>Skip for now</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.switchPathLink}
          onPress={handleSwitchToPoster}
          accessibilityRole="button"
          accessibilityLabel="Switch to posting a task instead"
        >
          <Text style={styles.switchPathLinkText}>Need something done instead? Switch to Poster</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
