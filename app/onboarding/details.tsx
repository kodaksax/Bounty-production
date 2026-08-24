/**
 * Details Onboarding Screen
 * Third step: branches on the intent picked at welcome.tsx into one of four
 * UIs (generic profile form / poster composer+funding / hunter
 * location+sample-bounty). This file owns state + handlers only; the actual
 * screen UIs live in components/onboarding/*.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CombinedActivationPrompt } from '../../components/onboarding/CombinedActivationPrompt';
import { HunterLocationPrompt } from '../../components/onboarding/HunterLocationPrompt';
import { HunterSampleBountyScreen } from '../../components/onboarding/HunterSampleBountyScreen';
import { PosterFundingScreen } from '../../components/onboarding/PosterFundingScreen';
import { PosterTaskPrompt } from '../../components/onboarding/PosterTaskPrompt';
import { ProfileDetailsForm } from '../../components/onboarding/ProfileDetailsForm';
import { UnserviceableRegionWaitlistScreen } from '../../components/onboarding/UnserviceableRegionWaitlistScreen';
import { useAttachmentUpload } from '../../hooks/use-attachment-upload';
import { useAuthContext } from '../../hooks/use-auth-context';
import { useAuthProfile } from '../../hooks/useAuthProfile';
import { useNormalizedProfile } from '../../hooks/useNormalizedProfile';
import { useUserProfile } from '../../hooks/useUserProfile';
import { useOnboarding } from '../../lib/context/onboarding-context';
import { isLocalBounty, rankNearbyBounties } from '../../lib/onboarding/hunter-discovery';
import { makeOnboardingDetailsStyles } from '../../lib/onboarding/onboarding-details-styles';
import { analyticsService } from '../../lib/services/analytics-service';
import { authProfileService } from '../../lib/services/auth-profile-service';
import { bountyRequestService } from '../../lib/services/bounty-request-service';
import { bountyService } from '../../lib/services/bounty-service';
import { Bounty, Profile } from '../../lib/services/database.types';
import { locationService } from '../../lib/services/location-service';
import { notificationService } from '../../lib/services/notification-service';
import { getOnboardingCompleteKey } from '../../lib/storage/onboarding';
import { supabase } from '../../lib/supabase';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { LocationCoordinates } from '../../lib/types';
import {
    validateAmount,
    validateDescription,
    validateTitle,
} from '../../lib/utils/bounty-validation';
import { getUserFriendlyError, type UserFriendlyError } from '../../lib/utils/error-messages';
import { isValidUsZip } from '../../lib/utils/geo';
import {
    buildServiceabilityContext,
    getDeviceServiceabilityContext,
} from '../../lib/utils/serviceable-region';
import { bountyService as bountyCreationService } from '../services/bountyService';

const HUNTER_DISCOVERY_FETCH_LIMIT = 20;

export default function DetailsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { profile: localProfile, updateProfile } = useUserProfile();
  const { userId, updateProfile: updateAuthProfile } = useAuthProfile();
  const { session } = useAuthContext();
  const { profile: normalized } = useNormalizedProfile();
  const { data: onboardingData, updateData: updateOnboardingData } = useOnboarding();
  const { theme } = useAppThemeContext();
  const styles = useMemo(() => makeOnboardingDetailsStyles(theme), [theme]);

  // Initialize from context, then fallback to profile data
  const [displayName, setDisplayName] = useState<string>(
    onboardingData.displayName ||
      (normalized as any)?.name ||
      (localProfile as any)?.displayName ||
      ''
  );
  const [title, setTitle] = useState<string>(
    onboardingData.title ||
      ((normalized as any)?._raw && (normalized as any)._raw.title) ||
      (localProfile as any)?.title ||
      ''
  );
  const [bio, setBio] = useState<string>(
    onboardingData.bio ||
      ((normalized as any)?._raw && (normalized as any)._raw.bio) ||
      (localProfile as any)?.bio ||
      ''
  );
  const [location, setLocation] = useState<string>(
    onboardingData.location ||
      ((normalized as any)?._raw && (normalized as any)._raw.location) ||
      (localProfile as any)?.location ||
      ''
  );
  const [skills, setSkills] = useState<string[]>(
    onboardingData.skills.length > 0
      ? onboardingData.skills
      : ((normalized as any)?._raw && (normalized as any)._raw.skills) ||
          (localProfile as any)?.skills ||
          []
  );
  const [customSkill, setCustomSkill] = useState('');
  const [saving, setSaving] = useState(false);
  const [avatarUri, setAvatarUri] = useState<string | undefined>(
    onboardingData.avatarUri || undefined
  );
  const [serviceabilityContext, setServiceabilityContext] = useState(() =>
    getDeviceServiceabilityContext()
  );
  const [bypassUnserviceableGate, setBypassUnserviceableGate] = useState(false);
  const [waitlistEmail, setWaitlistEmail] = useState(session?.user?.email ?? '');
  const [waitlistJoining, setWaitlistJoining] = useState(false);
  const [waitlistJoined, setWaitlistJoined] = useState(false);
  const [waitlistError, setWaitlistError] = useState<string | null>(null);
  const unserviceableShownRef = useRef(false);

  // Uploads profile photos to the same bucket/folder the live profile-edit
  // screen uses (bucket 'profiles', folder 'avatars') so RLS + downstream
  // reads (e.g. messaging avatars) resolve correctly — onboarding previously
  // used a different bucket ('attachments') than every other avatar upload
  // path in the app.
  const avatarUpload = useAttachmentUpload({
    bucket: 'profiles',
    folder: 'avatars',
    allowedTypes: 'images',
    maxSizeMB: 5,
  });

  // Hunter-flow-only state
  const [hunterStep, setHunterStep] = useState<'location' | 'sample'>('location');
  const [recentBounties, setRecentBounties] = useState<Bounty[] | null>(null);
  const [applying, setApplying] = useState(false);
  // Which bucket `recentBounties` currently holds — drives the empty-state
  // copy/CTA and the subtle "enable location" link on the sample screen.
  const [bountySource, setBountySource] = useState<'nearby' | 'online' | null>(null);
  // True while GPS/ZIP resolution or a browse-online/retry fetch is in flight.
  const [isResolvingLocation, setIsResolvingLocation] = useState(false);
  // Geocode-level ZIP failure (distinct from the inline format validation
  // HunterLocationPrompt already does before ever calling us).
  const [zipSubmitError, setZipSubmitError] = useState<string | null>(null);
  // Network/service failure from the last resolution attempt, with retry.
  const [discoveryError, setDiscoveryError] = useState<UserFriendlyError | null>(null);
  // Re-invokes whichever discovery method last failed, for the ErrorBanner's retry action.
  const retryDiscoveryRef = useRef<(() => void) | null>(null);

  // Poster-flow-only state
  const [posting, setPosting] = useState(false);
  const [posterStep, setPosterStep] = useState<'task' | 'funding'>('task');
  // AddMoneyScreen calls onAddMoney then immediately onBack on a successful
  // deposit. This ref (synchronous, unlike state) lets our onBack handler
  // detect that case and skip resetting posterStep back to 'task' while the
  // bounty is being created in the background.
  const postingRef = useRef(false);

  useEffect(() => {
    analyticsService.trackEvent('onboarding_profile_step_viewed', {
      intent: onboardingData.intent ?? 'none',
    });
    // Only fire once per mount of this branch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // post_started — the FIRST genuine interaction with the onboarding poster
  // composer. Emitted with the same event name as the main composer
  // (app/screens/CreateBounty) so both posting surfaces roll up into one
  // funnel, split by `surface` — which means it also has to mean the same
  // thing on both.
  //
  // It used to fire from an effect keyed on `intent === 'poster'`, i.e. the
  // instant the user tapped "I need help". That made the declared-poster
  // funnel's first step a tautology: declaring poster intent WAS the
  // post_started, so the step could never show loss, and the real drop
  // between "said they'd post" and "began composing" was invisible. Gating
  // it on a real edit measures that gap instead. See the matching change on
  // the create_flow surface for the tab-traffic version of the same bug.
  //
  // `resumed_draft` is snapshotted at the point of first interaction rather
  // than read live, so the poster's own first keystroke can't make a cold
  // start look resumed.
  const posterFunnelStartedRef = useRef(false);
  const markPosterComposerStarted = (
    trigger: 'task_edit' | 'price_edit' | 'schedule_edit' | 'publish'
  ) => {
    if (onboardingData.intent !== 'poster' || posterFunnelStartedRef.current) return;
    posterFunnelStartedRef.current = true;
    analyticsService.trackEvent('post_started', {
      surface: 'onboarding',
      // snake_case to match the same property on the main composer's
      // post_started call (app/screens/CreateBounty/index.tsx) — previously
      // `resumedDraft` here, which the (now-removed) analytics-service
      // key-normalizer expanded into three competing spellings on PostHog.
      resumed_draft: Boolean(onboardingData.taskDescription?.trim()),
      trigger,
    });
  };

  // A bounty was already created earlier in this onboarding session (e.g. the
  // user navigated back into this screen after createBountyNow succeeded).
  // Redirect straight to the congrats screen instead of re-rendering the
  // poster composer, which would let them post a second bounty.
  useEffect(() => {
    if (onboardingData.intent === 'poster' && onboardingData.firstBountyPostedId) {
      router.replace('/onboarding/bounty-posted');
    }
  }, [onboardingData.intent, onboardingData.firstBountyPostedId, router]);

  // An application was already submitted earlier in this onboarding session
  // (e.g. the user navigated back into this screen after handleApplyToSample
  // succeeded). Redirect straight to the congrats screen instead of
  // re-rendering the sample-bounty screen, which would let them apply twice.
  useEffect(() => {
    if (onboardingData.intent === 'hunter' && onboardingData.firstAppliedBountyId) {
      router.replace('/onboarding/application-submitted');
    }
  }, [onboardingData.intent, onboardingData.firstAppliedBountyId, router]);

  // Initial (pre-location) preview: recent local bounties, recency-sorted —
  // matches what the location prompt shows before we know where the hunter
  // is. Once location/ZIP resolves, resolveNearby() re-ranks a fresh fetch by
  // real distance instead. Also runs pre-choice for the 'onboarding-skip-role-
  // selection' test arm, since CombinedActivationPrompt shows the same
  // preview before intent is even set.
  const needsPreviewFetch =
    onboardingData.intent === 'hunter' ||
    (onboardingData.experimentVariant === 'test' && !onboardingData.intent);
  useEffect(() => {
    if (!needsPreviewFetch) return;
    let cancelled = false;
    bountyService
      .getAll({ status: 'open', limit: HUNTER_DISCOVERY_FETCH_LIMIT })
      .then(bounties => {
        if (cancelled) return;
        setRecentBounties(bounties.filter(isLocalBounty).slice(0, 2));
        setBountySource('nearby');
      })
      .catch(() => {
        if (!cancelled) {
          setRecentBounties([]);
          setBountySource('nearby');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [needsPreviewFetch]);

  // Sync state changes to context
  useEffect(() => {
    updateOnboardingData({ displayName });
  }, [displayName]);

  useEffect(() => {
    updateOnboardingData({ title });
  }, [title]);

  useEffect(() => {
    updateOnboardingData({ bio });
  }, [bio]);

  useEffect(() => {
    updateOnboardingData({ location });
  }, [location]);

  useEffect(() => {
    updateOnboardingData({ skills });
  }, [skills]);

  useEffect(() => {
    if (avatarUri) {
      updateOnboardingData({ avatarUri });
    }
  }, [avatarUri]);

  useEffect(() => {
    if (!waitlistEmail && session?.user?.email) {
      setWaitlistEmail(session.user.email);
    }
  }, [session?.user?.email, waitlistEmail]);

  useEffect(() => {
    analyticsService.updateUserProperties(serviceabilityContext);
  }, [
    serviceabilityContext.country_code,
    serviceabilityContext.region,
    serviceabilityContext.is_serviceable_region,
  ]);

  useEffect(() => {
    if (serviceabilityContext.is_serviceable_region !== false || unserviceableShownRef.current) {
      return;
    }
    unserviceableShownRef.current = true;
    analyticsService.trackEvent('unserviceable_region_shown', {
      country_code: serviceabilityContext.country_code,
      region: serviceabilityContext.region,
    });
  }, [
    serviceabilityContext.country_code,
    serviceabilityContext.region,
    serviceabilityContext.is_serviceable_region,
  ]);

  const handleJoinRegionWaitlist = async () => {
    const normalizedEmail = waitlistEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setWaitlistError('Enter a valid email address.');
      return;
    }

    setWaitlistJoining(true);
    setWaitlistError(null);
    try {
      const { error } = await supabase.from('region_waitlist_signups').upsert(
        {
          user_id: session?.user?.id ?? null,
          email: normalizedEmail,
          country_code: serviceabilityContext.country_code ?? null,
          region: serviceabilityContext.region ?? null,
          source: 'mobile_onboarding_unserviceable',
        },
        {
          onConflict: 'email,country_code',
        }
      );

      if (error) {
        throw error;
      }

      setWaitlistJoined(true);
    } catch (error) {
      console.error('[Onboarding] Failed to join region waitlist:', error);
      setWaitlistError('Could not save your waitlist request. Please try again.');
    } finally {
      setWaitlistJoining(false);
    }
  };

  const pickAvatar = async () => {
    const results = await avatarUpload.pickAttachment();
    const uploaded = results?.[0];
    if (uploaded) {
      setAvatarUri(uploaded.remoteUri || uploaded.uri);
    }
  };

  const toggleSkill = (skill: string) => {
    if (skills.includes(skill)) {
      setSkills(skills.filter(s => s !== skill));
    } else {
      setSkills([...skills, skill]);
    }
  };

  const addCustomSkill = () => {
    const trimmedSkill = customSkill.trim();
    if (trimmedSkill && !skills.includes(trimmedSkill)) {
      setSkills([...skills, trimmedSkill]);
      setCustomSkill('');
    }
  };

  const removeSkill = (skill: string) => {
    setSkills(skills.filter(s => s !== skill));
  };

  const handleNext = async () => {
    setSaving(true);

    // Save to local storage with all fields
    const result = await updateProfile({
      displayName: displayName.trim() || undefined,
      title: (title.trim() || undefined) as any,
      bio: (bio.trim() || undefined) as any,
      location: (location.trim() || undefined) as any,
      skills: skills.length > 0 ? skills : undefined,
      avatar: avatarUri || undefined,
    } as any);

    if (!result.success) {
      setSaving(false);
      Alert.alert('Error', result.error || 'Failed to save details');
      return;
    }

    // Sync all fields to Supabase via direct update
    // This ensures profile data persists to the database and is available across devices
    // We update the profiles table directly to ensure all fields are saved
    const saveToSupabase = async () => {
      const resolvedUserId = userId || session?.user?.id;
      if (!resolvedUserId) {
        console.error('[Onboarding Details] Cannot save profile: missing authenticated user id');
        return false;
      }

      const profileUpdate: Partial<Profile> = {};

      if (displayName.trim()) {
        profileUpdate.display_name = displayName.trim();
      }
      if (title.trim()) {
        profileUpdate.title = title.trim();
      }
      if (bio.trim()) {
        profileUpdate.about = bio.trim();
      }
      if (location.trim()) {
        profileUpdate.location = location.trim();
      }
      if (skills.length > 0) {
        profileUpdate.skills = skills;
      }
      // Only persist avatar when we have a confirmed remote URI,
      // not a local file:// path that would break on other devices.
      if (avatarUri && !avatarUri.startsWith('file://')) {
        profileUpdate.avatar = avatarUri;
      }

      // Only update if we have fields to save
      if (Object.keys(profileUpdate).length === 0) {
        return true;
      }

      const { error } = await supabase
        .from('profiles')
        .update(profileUpdate)
        .eq('id', resolvedUserId);

      if (error) {
        console.error('[Onboarding Details] Error saving to Supabase:', error);
        return false;
      }

      console.log('[Onboarding Details] Successfully saved profile data to database');
      return true;
    };

    try {
      const success = await saveToSupabase();

      if (!success) {
        setSaving(false);

        // Handle retry attempts with user feedback - allows up to 3 total attempts
        const handleRetryAttempts = async () => {
          setSaving(true);
          const retrySuccess = await saveToSupabase();
          if (retrySuccess) {
            setSaving(false);
            router.push('/onboarding/done');
          } else {
            setSaving(false);
            // Show option to skip after second failed attempt
            Alert.alert(
              'Still Unable to Save',
              'We could not save your profile. You can skip this step and update your profile later.',
              [
                {
                  text: 'Try One More Time',
                  onPress: async () => {
                    setSaving(true);
                    const finalSuccess = await saveToSupabase();
                    setSaving(false);
                    if (finalSuccess) {
                      router.push('/onboarding/done');
                    } else {
                      // After 3 attempts, just allow skip
                      Alert.alert(
                        'Unable to Save',
                        'Please skip for now and try again later from your profile settings.',
                        [{ text: 'OK', onPress: () => router.push('/onboarding/done') }]
                      );
                    }
                  },
                },
                {
                  text: 'Skip for now',
                  style: 'cancel',
                  onPress: () => router.push('/onboarding/done'),
                },
              ]
            );
          }
        };

        Alert.alert(
          'Connection Error',
          'Failed to save your profile. Please check your internet connection and try again.',
          [
            {
              text: 'Retry',
              onPress: handleRetryAttempts,
            },
            {
              text: 'Skip for now',
              style: 'cancel',
              onPress: () => router.push('/onboarding/done'),
            },
          ]
        );
        return;
      }
    } catch (error) {
      console.error('[Onboarding Details] Exception saving to Supabase:', error);
      setSaving(false);
      Alert.alert(
        'Connection Error',
        'An unexpected error occurred. You can skip this step and update your profile later.',
        [
          {
            text: 'Skip for now',
            style: 'cancel',
            onPress: () => router.push('/onboarding/done'),
          },
        ]
      );
      return;
    }

    setSaving(false);
    analyticsService.trackEvent('onboarding_profile_submitted', { intent: 'none' });
    router.push('/onboarding/done');
  };

  const handleSkip = () => {
    analyticsService.trackEvent('onboarding_step_skipped', { step: 'details', intent: 'none' });
    router.push('/onboarding/done');
  };

  const handleBack = () => {
    router.back();
  };

  // Last-resort skip: bypass the rest of onboarding (connect, etc.) entirely
  // and drop the user straight into the app. Marks onboarding as complete so
  // they aren't routed back here on next launch.
  const handleSkipToApp = async () => {
    const resolvedUserId = userId || session?.user?.id;

    analyticsService.trackEvent('onboarding_step_skipped', {
      step: 'details',
      intent: onboardingData.intent ?? 'none',
      terminal: true,
    });

    if (resolvedUserId) {
      try {
        await AsyncStorage.setItem(getOnboardingCompleteKey(resolvedUserId), 'true');
      } catch (err) {
        console.error('[Onboarding] Skip: AsyncStorage write failed:', err);
      }
    }

    try {
      await authProfileService.updateProfile({ onboarding_completed: true } as any);
    } catch (err) {
      console.error('[Onboarding] Skip: updateProfile failed:', err);
    }

    router.replace('/tabs/bounty-app');
  };

  // Fetches a fresh batch of local bounties and ranks them by real distance
  // from `userCoords` (falling back to recency for bounties we can't measure
  // — see lib/onboarding/hunter-discovery.ts). Always advances to the sample
  // step: an empty ranked list is a valid "no nearby bounties" outcome that
  // HunterSampleBountyScreen renders its own empty state for. Only a thrown
  // fetch error keeps the hunter fon the location screen (with a retry banner).
  const resolveNearbyBounties = async (userCoords: LocationCoordinates) => {
    const all = await bountyService.getAll({ status: 'open', limit: HUNTER_DISCOVERY_FETCH_LIMIT });
    const ranked = rankNearbyBounties(all, userCoords);
    setRecentBounties(ranked);
    setBountySource('nearby');
    analyticsService.trackEvent(
      ranked.length === 0 ? 'onboarding_no_nearby_bounties' : 'onboarding_nearby_bounties_shown',
      { intent: 'hunter', count: ranked.length }
    );
    setHunterStep('sample');
  };

  // Backs three entry points: the "Browse Online Bounties" empty-state CTA,
  // the location-permission-denied fallback, and "Skip for now" — all three
  // should immediately show online/remote bounties rather than a dead end.
  const handleBrowseOnline = async () => {
    setDiscoveryError(null);
    setIsResolvingLocation(true);
    retryDiscoveryRef.current = handleBrowseOnline;
    try {
      const online = await bountyService.getAll({
        status: 'open',
        workType: 'online',
        limit: HUNTER_DISCOVERY_FETCH_LIMIT,
      });
      setRecentBounties(online);
      setBountySource('online');
      analyticsService.trackEvent('onboarding_online_bounties_viewed', {
        intent: 'hunter',
        count: online.length,
      });
      setHunterStep('sample');
    } catch (err) {
      console.error('[Onboarding] Failed to load online bounties:', err);
      setDiscoveryError(getUserFriendlyError(err));
    } finally {
      setIsResolvingLocation(false);
    }
  };

  const handleUseLocation = async () => {
    setZipSubmitError(null);
    setDiscoveryError(null);
    setIsResolvingLocation(true);
    retryDiscoveryRef.current = handleUseLocation;
    try {
      const permission = await locationService.requestPermission();
      if (!permission.granted) {
        analyticsService.trackEvent('onboarding_location_permission_denied', { intent: 'hunter' });
        await handleBrowseOnline();
        return;
      }
      analyticsService.trackEvent('onboarding_location_permission_granted', { intent: 'hunter' });

      const coords = await locationService.getCurrentLocation();
      if (!coords) {
        throw new Error('Could not determine your current location.');
      }

      const regionMetadata = await locationService.reverseGeocodeRegion(coords);
      if (regionMetadata?.countryCode) {
        const nextServiceability = buildServiceabilityContext({
          countryCode: regionMetadata.countryCode,
          region: regionMetadata.region || regionMetadata.city,
        });
        setServiceabilityContext(nextServiceability);
        analyticsService.updateUserProperties(nextServiceability);
      }

      // Best-effort display text; distance ranking below doesn't depend on it.
      locationService
        .reverseGeocode(coords)
        .then(address => {
          if (address) setLocation(address);
        })
        .catch(() => {});

      await resolveNearbyBounties(coords);
    } catch (err) {
      console.error('[Onboarding] handleUseLocation failed:', err);
      setDiscoveryError(getUserFriendlyError(err));
    } finally {
      setIsResolvingLocation(false);
    }
  };

  const handleSubmitZip = async (zip: string) => {
    if (!isValidUsZip(zip)) {
      setZipSubmitError('Enter a valid 5-digit ZIP code.');
      return;
    }
    setZipSubmitError(null);
    setDiscoveryError(null);
    setIsResolvingLocation(true);
    retryDiscoveryRef.current = () => handleSubmitZip(zip);
    try {
      const coords = await locationService.geocodeAddress(zip);
      if (!coords) {
        setZipSubmitError(
          "We couldn't find that ZIP code. Try another, or use your location instead."
        );
        return;
      }
      analyticsService.trackEvent('onboarding_zip_searched', { intent: 'hunter' });

      const nextServiceability = buildServiceabilityContext({
        countryCode: 'US',
        region: zip,
      });
      setServiceabilityContext(nextServiceability);
      analyticsService.updateUserProperties(nextServiceability);

      setLocation(zip);
      // Save as user metadata (only now that it's confirmed a real ZIP) so
      // they can be matched to bounties posted in the same ZIP later.
      try {
        await updateAuthProfile({ zip_code: zip });
      } catch (err) {
        console.error('[Onboarding] Failed to save zip code to profile:', err);
      }

      await resolveNearbyBounties(coords);
    } catch (err) {
      console.error('[Onboarding] handleSubmitZip failed:', err);
      setDiscoveryError(getUserFriendlyError(err));
    } finally {
      setIsResolvingLocation(false);
    }
  };

  const handleSkipLocation = () => {
    analyticsService.trackEvent('onboarding_step_skipped', {
      step: 'hunter_location',
      intent: 'hunter',
    });
    handleBrowseOnline();
  };

  // Re-invokes whichever discovery method last failed (GPS, ZIP, or browse
  // online) — wired to retryDiscoveryRef, which each of those setters above.
  const handleRetryDiscovery = () => {
    retryDiscoveryRef.current?.();
  };

  if (serviceabilityContext.is_serviceable_region === false && !bypassUnserviceableGate) {
    return (
      <UnserviceableRegionWaitlistScreen
        theme={theme}
        styles={styles}
        insets={insets}
        email={waitlistEmail}
        onChangeEmail={setWaitlistEmail}
        onJoinWaitlist={handleJoinRegionWaitlist}
        joining={waitlistJoining}
        joined={waitlistJoined}
        error={waitlistError}
        countryCode={serviceabilityContext.country_code}
        region={serviceabilityContext.region}
        onContinue={() => setBypassUnserviceableGate(true)}
      />
    );
  }

  // Requests push permission/registers a token so a hunter with no nearby
  // bounties can be notified when one appears in their area later. Resolves
  // true if permission was granted.
  const handleNotifyMe = async (): Promise<boolean> => {
    analyticsService.trackEvent('onboarding_notify_me_requested', { intent: 'hunter' });
    const token = await notificationService.requestPermissionsAndRegisterToken();
    return Boolean(token);
  };

  // Lets a poster/hunter change their mind mid-flow (e.g. tapped the wrong
  // one on welcome.tsx) without restarting onboarding from scratch. Resets
  // both flows' internal step state so they land at the start of the other.
  const handleSwitchIntent = (intent: 'poster' | 'hunter') => {
    analyticsService.trackEvent('onboarding_intent_switched', { to: intent });
    updateOnboardingData({ intent });
    setPosterStep('task');
    setHunterStep('location');
  };

  // Derives a valid bounty title (5-120 chars) from the free-form "what +
  // when + where" description the user typed.
  const deriveTitleFromDescription = (text: string): string => {
    const trimmed = text.trim();
    if (trimmed.length <= 60) return trimmed;
    const truncated = trimmed.slice(0, 60);
    const lastSpace = truncated.lastIndexOf(' ');
    return (lastSpace > 20 ? truncated.slice(0, lastSpace) : truncated).trim();
  };

  // Validates the task screen's inputs, then moves on to the funding step —
  // the actual bounty isn't created until funding is resolved (paid via
  // createBountyNow(false), or skipped as an honor bounty via
  // createBountyNow(true)).
  const handlePostBounty = () => {
    // Backstop so a publish can never outrun its own funnel start — every
    // realistic path here already edited at least the description.
    markPosterComposerStarted('publish');
    const description = onboardingData.taskDescription.trim();
    const descriptionError = validateDescription(description);
    if (descriptionError) {
      Alert.alert('Tell us more', descriptionError);
      return;
    }

    const title = deriveTitleFromDescription(description);
    const titleError = validateTitle(title);
    if (titleError) {
      Alert.alert('Tell us more', titleError);
      return;
    }

    const amount = Number(onboardingData.price);
    const amountError = validateAmount(amount, false);
    if (!onboardingData.price || Number.isNaN(amount) || amountError) {
      Alert.alert('Set a price', amountError || 'Enter a valid price for this bounty.');
      return;
    }

    // amount_set — the onboarding composer always collects a real price here
    // (validateAmount(amount, false) above rejects $0), so any $0 bounty from
    // this surface came from the funding screen's skip link, not from this
    // step. That makes the amount_set -> post_published(funded) gap a clean
    // measure of the skip link's cost.
    analyticsService.trackEvent('amount_set', {
      surface: 'onboarding',
      amount,
      isForHonor: false,
      method: 'custom',
      schedule: onboardingData.schedule ?? 'none',
    });

    setPosterStep('funding');
  };

  // Creates the real bounty row. isForHonor=false requires the poster's
  // wallet balance to already cover `amount` — a DB trigger
  // (fn_reserve_bounty_escrow) atomically reserves escrow on insert and
  // rolls back the whole insert with an "Insufficient funds" error if not.
  // Returns true on success so callers know whether to navigate onward.
  const createBountyNow = async (isForHonor: boolean): Promise<boolean> => {
    const description = onboardingData.taskDescription.trim();
    const title = deriveTitleFromDescription(description);
    const amount = Number(onboardingData.price) || 0;

    setPosting(true);
    try {
      const result = await bountyCreationService.createBounty({
        title,
        description,
        amount: isForHonor ? 0 : amount,
        isForHonor,
        location: onboardingData.location || 'Nearby',
        workType: 'in_person',
        scheduleType:
          onboardingData.schedule === 'saturday'
            ? 'scheduled'
            : onboardingData.schedule === 'flexible'
              ? 'flexible'
              : undefined,
        timeline:
          onboardingData.schedule === 'saturday'
            ? 'Saturday'
            : onboardingData.schedule === 'flexible'
              ? 'Flexible'
              : undefined,
      });
      analyticsService.trackEvent('onboarding_bounty_posted', { isForHonor, amount });
      // post_published — same terminal funnel event as the main composer.
      // `funded` is the headline metric: did this published bounty carry real
      // money. Kept alongside the pre-existing onboarding_bounty_posted event
      // rather than replacing it, so existing onboarding insights don't break.
      analyticsService.trackEvent('post_published', {
        surface: 'onboarding',
        bountyId: String(result.bounty.id),
        amount: isForHonor ? 0 : amount,
        isForHonor,
        funded: !isForHonor && amount > 0,
        category: 'none',
        workType: 'in_person',
        architecture: 1,
        queuedOffline: false,
      });
      updateOnboardingData({
        firstBountyPostedId: String(result.bounty.id),
        firstBountyPostedTitle: result.bounty.title,
        firstBountyPostedAmount: result.bounty.amount,
      });
      router.replace('/onboarding/bounty-posted');
      return true;
    } catch (err) {
      console.error('[Onboarding] Failed to post bounty:', err);
      const message = err instanceof Error ? err.message : 'Please try again.';
      if (/insufficient funds/i.test(message)) {
        Alert.alert(
          'Not enough funds yet',
          `Your wallet doesn't have enough to cover $${amount}. Add more, or skip and post this for free instead.`
        );
      } else {
        Alert.alert('Could not post bounty', message);
      }
      return false;
    } finally {
      setPosting(false);
    }
  };

  const handleFundingSuccess = async () => {
    // payment_attached — a real deposit just cleared, so the wallet now covers
    // the bounty. Distinguished from the main composer's
    // `source: 'existing_balance'` because this is the only surface in the app
    // that currently funds a wallet as part of posting.
    analyticsService.trackEvent('payment_attached', {
      surface: 'onboarding',
      amount: Number(onboardingData.price) || 0,
      source: 'deposit',
      architecture: 1,
    });
    postingRef.current = true;
    try {
      await createBountyNow(false);
    } finally {
      postingRef.current = false;
    }
  };

  const handleSkipFunding = async ({ hasPaymentMethod }: { hasPaymentMethod: boolean }) => {
    // The single sharpest known cause of $0 bounties: the poster composed a
    // priced bounty, reached the funding screen, and took the "Post as For
    // Honor instead" link sitting under the pay button. `previousAmount` is
    // the price they had already committed to — the money this link costs.
    analyticsService.trackEvent('post_funding_skipped_to_honor', {
      surface: 'onboarding',
      previousAmount: Number(onboardingData.price) || 0,
      hasPaymentMethod,
    });
    await createBountyNow(true);
  };

  const handleApplyToSample = async () => {
    // Synchronous re-entrancy guard against a fast double-tap outrunning the
    // `applying` state update that disables the button (belt-and-suspenders;
    // the DB's unique_bounty_hunter constraint also makes a second insert
    // idempotent, but this avoids firing a redundant network call/analytics
    // event).
    if (applying) return;

    const sampleBounty = recentBounties && recentBounties.length > 0 ? recentBounties[0] : null;
    const hunterId = userId || session?.user?.id;

    if (!sampleBounty || !hunterId) {
      // No real bounty to apply to (mock preview / no session) — nothing to
      // confirm, so just continue to the generic profile-summary screen.
      router.push('/onboarding/done');
      return;
    }

    // Onboarding applies to a real, live, randomly-selected open bounty (see
    // the module comment on getPreviewCards in previewBounties.ts — there is
    // no fixed/fabricated demo bounty), so bounty_claim_* here is a genuine
    // application, just tagged so it never counts as real marketplace demand.
    analyticsService.trackEvent('bounty_claim_started', {
      bounty_id: String(sampleBounty.id),
      amount: typeof sampleBounty.amount === 'number' ? sampleBounty.amount : undefined,
      is_for_honor: Boolean(sampleBounty.is_for_honor),
      source: 'onboarding',
      is_onboarding_demo: true,
    });

    setApplying(true);
    try {
      const result = await bountyRequestService.create({
        bounty_id: String(sampleBounty.id),
        hunter_id: hunterId,
        status: 'pending',
        poster_id: sampleBounty.poster_id || (sampleBounty as any).user_id,
        message: null,
      } as any);

      if (result.success) {
        analyticsService.trackEvent('bounty_claim_submitted', {
          bounty_id: String(sampleBounty.id),
          is_onboarding_demo: true,
          had_message: false,
          attachment_count: 0,
        });
        // RENAMED from 'onboarding_bounty_accepted' — see analytics-service.ts.
        analyticsService.trackEvent('onboarding_bounty_applied', {
          bountyId: String(sampleBounty.id),
        });
        updateOnboardingData({
          firstAppliedBountyId: String(sampleBounty.id),
          firstAppliedBountyTitle: sampleBounty.title,
          firstBountyRequestId: String(result.request.id),
        });
        router.replace('/onboarding/application-submitted');
        return;
      }

      console.warn('[Onboarding] Bounty application failed:', result.error);
      analyticsService.trackEvent('bounty_claim_failed', {
        bounty_id: String(sampleBounty.id),
        reason: /banned|suspended/i.test(result.error || '') ? 'not_eligible' : 'validation',
        is_onboarding_demo: true,
      });
      Alert.alert(
        'Could Not Submit Application',
        result.error || 'Please check your connection and try again.',
        [
          { text: 'Try Again', onPress: () => handleApplyToSample() },
          { text: 'Cancel', style: 'cancel' },
        ]
      );
    } catch (err) {
      console.error('[Onboarding] Failed to apply to sample bounty:', err);
      analyticsService.trackEvent('bounty_claim_failed', {
        bounty_id: String(sampleBounty.id),
        reason: 'network',
        is_onboarding_demo: true,
      });
      Alert.alert(
        'Connection Error',
        "We couldn't submit your application. Please check your internet connection and try again.",
        [
          { text: 'Try Again', onPress: () => handleApplyToSample() },
          { text: 'Cancel', style: 'cancel' },
        ]
      );
    } finally {
      setApplying(false);
    }
  };

  if (onboardingData.intent === 'poster') {
    if (posterStep === 'funding') {
      return (
        <PosterFundingScreen
          styles={styles}
          price={onboardingData.price}
          posting={posting}
          onBack={() => {
            if (postingRef.current) return;
            setPosterStep('task');
          }}
          onFunded={handleFundingSuccess}
          onSkip={handleSkipFunding}
        />
      );
    }
    return (
      <PosterTaskPrompt
        theme={theme}
        styles={styles}
        insets={insets}
        taskDescription={onboardingData.taskDescription}
        onChangeTaskDescription={taskDescription => {
          markPosterComposerStarted('task_edit');
          updateOnboardingData({ taskDescription });
        }}
        price={onboardingData.price}
        onChangePrice={price => {
          markPosterComposerStarted('price_edit');
          updateOnboardingData({ price });
        }}
        schedule={onboardingData.schedule}
        onChangeSchedule={schedule => {
          markPosterComposerStarted('schedule_edit');
          updateOnboardingData({ schedule });
        }}
        onNext={handlePostBounty}
        posting={posting}
        onSkip={handleSkipToApp}
        onSwitchToHunter={() => handleSwitchIntent('hunter')}
        onBack={handleBack}
      />
    );
  }

  if (onboardingData.intent === 'hunter') {
    if (hunterStep === 'location') {
      return (
        <HunterLocationPrompt
          theme={theme}
          styles={styles}
          insets={insets}
          displayName={displayName || (normalized as any)?.name || 'there'}
          recentBounties={recentBounties}
          onUseLocation={handleUseLocation}
          onSubmitZip={handleSubmitZip}
          onSkip={handleSkipLocation}
          onSwitchToPoster={() => handleSwitchIntent('poster')}
          onBack={handleBack}
          isResolvingLocation={isResolvingLocation}
          zipSubmitError={zipSubmitError}
          discoveryError={discoveryError}
          onRetryDiscovery={handleRetryDiscovery}
        />
      );
    }
    return (
      <HunterSampleBountyScreen
        theme={theme}
        styles={styles}
        insets={insets}
        recentBounties={recentBounties}
        onNext={handleApplyToSample}
        applying={applying}
        onSkip={handleSkipToApp}
        onNotifyMe={handleNotifyMe}
        onSwitchToPoster={() => handleSwitchIntent('poster')}
        bountySource={bountySource}
        onBrowseOnline={handleBrowseOnline}
        onUseLocation={handleUseLocation}
        isResolvingLocation={isResolvingLocation}
        discoveryError={discoveryError}
        onRetryDiscovery={handleRetryDiscovery}
        onBack={() => setHunterStep('location')}
      />
    );
  }

  // 'onboarding-skip-role-selection' experiment, test arm: welcome.tsx sent
  // this user here with intent still null. Show the combined chooser instead
  // of the generic profile-only form; picking a card sets intent and the
  // branches above take over on the next render, unchanged.
  if (onboardingData.experimentVariant === 'test') {
    return (
      <CombinedActivationPrompt
        theme={theme}
        styles={styles}
        insets={insets}
        recentBounties={recentBounties}
        onChoosePoster={() => updateOnboardingData({ intent: 'poster' })}
        onChooseHunter={() => updateOnboardingData({ intent: 'hunter' })}
        onSkip={handleSkipToApp}
        onBack={handleBack}
      />
    );
  }

  return (
    <ProfileDetailsForm
      theme={theme}
      styles={styles}
      insets={insets}
      avatarUri={avatarUri}
      uploading={avatarUpload.isUploading || avatarUpload.isPicking}
      onPickAvatar={pickAvatar}
      displayName={displayName}
      onChangeDisplayName={setDisplayName}
      title={title}
      onChangeTitle={setTitle}
      bio={bio}
      onChangeBio={setBio}
      location={location}
      onChangeLocation={setLocation}
      skills={skills}
      onToggleSkill={toggleSkill}
      onRemoveSkill={removeSkill}
      customSkill={customSkill}
      onChangeCustomSkill={setCustomSkill}
      onAddCustomSkill={addCustomSkill}
      onNext={handleNext}
      onSkip={handleSkip}
      onBack={handleBack}
      saving={saving}
    />
  );
}
