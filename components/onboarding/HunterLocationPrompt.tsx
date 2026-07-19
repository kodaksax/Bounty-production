import { MaterialIcons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { ErrorBanner } from '../error-banner';
import { Skeleton } from '../ui/skeleton';
import { OnboardingProgressDots } from './OnboardingProgressDots';
import { getPreviewCards, type PreviewCard } from './previewBounties';
import { hapticFeedback } from '../../lib/haptic-feedback';
import { isValidUsZip } from '../../lib/utils/geo';
import type { UserFriendlyError } from '../../lib/utils/error-messages';
import type { Bounty } from '../../lib/services/database.types';
import type { OnboardingDetailsStyles } from '../../lib/onboarding/onboarding-details-styles';
import type { AppTheme } from '../../lib/themes/types';

type HunterLocationPromptProps = {
  theme: AppTheme;
  styles: OnboardingDetailsStyles;
  insets: { top: number; bottom: number };
  displayName: string;
  recentBounties: Bounty[] | null;
  onUseLocation: () => void;
  /** Called with a validated (5-digit) ZIP once the hunter submits the inline ZIP search. */
  onSubmitZip: (zip: string) => void;
  onSkip: () => void;
  /** Subtle secondary escape hatch for someone who meant to pick Poster on welcome.tsx. */
  onSwitchToPoster: () => void;
  /** Returns to the style step. Matches the back button ProfileDetailsForm/PosterFundingScreen already have. */
  onBack: () => void;
  /** True while GPS or ZIP resolution is in flight — disables both CTAs and shows an inline spinner on whichever was pressed. */
  isResolvingLocation: boolean;
  /** Geocode-level ZIP failure surfaced by the parent (e.g. "couldn't find that ZIP"), distinct from local format validation. */
  zipSubmitError: string | null;
  /** Network/service failure from the last resolution attempt, with a retry action. */
  discoveryError: UserFriendlyError | null;
  onRetryDiscovery: () => void;
};

function PreviewCardRow({ card, styles }: { card: PreviewCard; styles: OnboardingDetailsStyles }) {
  return (
    <View style={styles.bountyCard}>
      <View style={styles.bountyCardTopRow}>
        <Text style={styles.bountyCardTitle} numberOfLines={1}>{card.title}</Text>
        <Text style={styles.bountyCardPrice}>{card.priceLabel}</Text>
      </View>
      <View style={styles.bountyCardMetaRow}>
        <Text style={styles.bountyCardMetaText}>{card.metaLabel}</Text>
      </View>
    </View>
  );
}

// Hunter branch, step 2 of 4: sign in -> [this] -> nearby feed -> done.
export function HunterLocationPrompt({
  theme,
  styles,
  insets,
  displayName,
  recentBounties,
  onUseLocation,
  onSubmitZip,
  onSkip,
  onSwitchToPoster,
  onBack,
  isResolvingLocation,
  zipSubmitError,
  discoveryError,
  onRetryDiscovery,
}: HunterLocationPromptProps) {
  const isLoading = recentBounties === null;
  const previewCards = getPreviewCards(recentBounties);

  const [zipEntryOpen, setZipEntryOpen] = useState(false);
  const [zipValue, setZipValue] = useState('');
  const [zipFormatError, setZipFormatError] = useState<string | null>(null);
  const [activeAction, setActiveAction] = useState<'gps' | 'zip' | null>(null);

  // Clear the pending-button spinner once the parent's resolution finishes
  // (success or failure) rather than tracking a duplicate loading flag here.
  useEffect(() => {
    if (!isResolvingLocation) setActiveAction(null);
  }, [isResolvingLocation]);

  const handleUseLocation = () => {
    hapticFeedback.light();
    setActiveAction('gps');
    onUseLocation();
  };

  const handleOpenZipEntry = () => {
    hapticFeedback.light();
    setZipEntryOpen(true);
  };

  const handleCancelZipEntry = () => {
    setZipEntryOpen(false);
    setZipFormatError(null);
  };

  const handleZipSearch = () => {
    if (!isValidUsZip(zipValue)) {
      setZipFormatError('Enter a valid 5-digit ZIP code.');
      return;
    }
    setZipFormatError(null);
    hapticFeedback.light();
    setActiveAction('zip');
    onSubmitZip(zipValue.trim());
  };

  const handleZipChange = (text: string) => {
    setZipValue(text.replace(/[^0-9]/g, '').slice(0, 5));
    if (zipFormatError) setZipFormatError(null);
  };

  const handleSwitchToPoster = () => {
    hapticFeedback.light();
    onSwitchToPoster();
  };

  const handleBack = () => {
    hapticFeedback.light();
    onBack();
  };

  const zipError = zipFormatError || zipSubmitError;

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.stepBackRow}>
        <TouchableOpacity
          onPress={handleBack}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <MaterialIcons name="arrow-back" size={24} color={theme.textSecondary} />
        </TouchableOpacity>
      </View>

      <View style={styles.hunterStatusRow}>
        <OnboardingProgressDots total={5} activeIndex={2} />
        <Text style={styles.hunterStatusSeparator}>·</Text>
        <Text style={styles.hunterStatusText}>
          Hunting as <Text style={styles.hunterStatusName}>{displayName}</Text>
        </Text>
      </View>

      <View style={styles.hunterContent}>
        {discoveryError ? (
          <View style={styles.discoveryErrorWrapper}>
            <ErrorBanner error={discoveryError} onAction={onRetryDiscovery} />
          </View>
        ) : null}

        {isLoading ? (
          <>
            <Skeleton style={{ height: 74, borderRadius: 16, marginBottom: 16 }} />
            <Skeleton style={{ height: 74, borderRadius: 16, marginBottom: 16 }} />
          </>
        ) : (
          // Real bounties only — never fabricate cards when the market is
          // genuinely empty; the heading and CTAs below stand fine alone.
          previewCards.map((card, index) => <PreviewCardRow key={index} card={card} styles={styles} />)
        )}

        <Text style={styles.hunterHeading}>See exactly how close{'\n'}the money is</Text>

        <View style={styles.hunterSpacer} />

        <View style={styles.hunterActions}>
          {zipEntryOpen ? (
            <>
              <View style={styles.zipInputRow}>
                <TextInput
                  style={[styles.input, styles.zipInput]}
                  value={zipValue}
                  onChangeText={handleZipChange}
                  placeholder="ZIP code"
                  placeholderTextColor={theme.textDisabled}
                  keyboardType="number-pad"
                  maxLength={5}
                  editable={!isResolvingLocation}
                  autoFocus
                  returnKeyType="search"
                  onSubmitEditing={handleZipSearch}
                  accessibilityLabel="ZIP code"
                />
                <TouchableOpacity
                  style={[styles.zipSearchButton, { backgroundColor: theme.primary }]}
                  onPress={handleZipSearch}
                  disabled={isResolvingLocation}
                  accessibilityRole="button"
                  accessibilityLabel="Search bounties near this ZIP code"
                  accessibilityState={{ disabled: isResolvingLocation, busy: activeAction === 'zip' }}
                >
                  {activeAction === 'zip' ? (
                    <ActivityIndicator color="#ffffff" />
                  ) : (
                    <Text style={styles.locationButtonText}>Search</Text>
                  )}
                </TouchableOpacity>
              </View>

              {zipError ? <Text style={styles.zipInlineError}>{zipError}</Text> : null}

              <TouchableOpacity
                style={styles.zipCancelLink}
                onPress={handleCancelZipEntry}
                disabled={isResolvingLocation}
                accessibilityRole="button"
                accessibilityLabel="Cancel ZIP search"
              >
                <Text style={styles.zipCancelLinkText}>Cancel</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <TouchableOpacity
                style={[styles.locationButton, { backgroundColor: theme.primary }]}
                onPress={handleUseLocation}
                disabled={isResolvingLocation}
                accessibilityRole="button"
                accessibilityLabel="Use my location to find bounties near me"
                accessibilityState={{ disabled: isResolvingLocation, busy: activeAction === 'gps' }}
              >
                {activeAction === 'gps' ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <Text style={styles.locationButtonText}>Use my location</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.zipButton}
                onPress={handleOpenZipEntry}
                disabled={isResolvingLocation}
                accessibilityRole="button"
                accessibilityLabel="Browse by ZIP code instead"
              >
                <Text style={styles.zipButtonText}>Browse by ZIP instead</Text>
              </TouchableOpacity>

              <Text style={styles.hunterFootnote}>
                Only your area is stored — never your exact address.
              </Text>
            </>
          )}

          <TouchableOpacity
            style={styles.skipLink}
            onPress={onSkip}
            disabled={isResolvingLocation}
            accessibilityRole="button"
            accessibilityLabel="Skip for now - you will see online/asynchronous bounties"
          >
            <Text style={styles.skipLinkText}>Skip for now - you will see online/asynchronous bounties</Text>
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
    </View>
  );
}

// Re-exported so HunterSampleBountyScreen can share the exact same card row
// (kept as one source of truth for the bounty-card layout).
export { PreviewCardRow };
