import { MaterialIcons } from '@expo/vector-icons';
import type { BountyDraft } from 'app/hooks/useBountyDraft';
import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { locationService } from '../../../../lib/services/location-service';
import { useAppThemeContext } from '../../../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../../../lib/themes/types';
import { QuickStepLayout } from './QuickStepLayout';

interface StepWhereProps {
  draft: BountyDraft;
  onUpdate: (data: Partial<BountyDraft>) => void;
  onNext: () => void;
  onBack: () => void;
  /** True while the parent persists this step onto a live bounty. */
  isSaving?: boolean;
  step: number;
  totalSteps: number;
}

/**
 * Step 3 — where the work happens.
 *
 * In-person bounties must carry coordinates or they never match nearby hunters
 * (hunter_service_areas proximity notifications + the feed's radius search), so
 * a typed address is forward-geocoded before advancing — the same guard the
 * previous location step applied.
 */
export function StepWhere({ draft, onUpdate, onNext, onBack, isSaving = false, step, totalSteps }: StepWhereProps) {
  const { theme } = useAppThemeContext();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const [isLocating, setIsLocating] = useState(false);
  const [isResolving, setIsResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // True once the poster taps "Use current location" — drives the selected
  // styling and the "Current location" label on the review step.
  const [usedCurrentLocation, setUsedCurrentLocation] = useState(
    draft.latitude != null && draft.longitude != null && !draft.location
  );

  const isOnline = draft.workType === 'online';

  const handleUseCurrentLocation = async () => {
    setError(null);
    setIsLocating(true);
    try {
      // Check current permission status first.
      const permStatus = await locationService.getPermissionStatus();

      if (!permStatus.granted) {
        if (!permStatus.canAskAgain) {
          // Permission permanently denied — tell the user where to fix it.
          Alert.alert(
            'Location access required',
            'Location permission is disabled. Please enable it in your device settings so we can use your current location.',
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Open Settings',
                onPress: () => {
                  if (Platform.OS === 'ios') {
                    Linking.openURL('app-settings:');
                  } else {
                    Linking.openSettings();
                  }
                },
              },
            ]
          );
          // isLocating is cleared by the finally block below.
          return;
        }

        // Permission not yet requested (or denied but can ask again) — request now.
        const requested = await locationService.requestPermission();
        if (!requested.granted) {
          if (!requested.canAskAgain) {
            Alert.alert(
              'Location Permission Required',
              'Please enable location access in your device settings to use this feature.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Open Settings',
                  onPress: () => {
                    if (Platform.OS === 'ios') {
                      Linking.openURL('app-settings:');
                    } else {
                      Linking.openSettings();
                    }
                  },
                },
              ]
            );
          } else {
            setError('Location permission denied. You can search a ZIP code or address instead.');
          }
          return;
        }
      }

      const coords = await locationService.getCurrentLocation();
      if (!coords) {
        setError('We could not get your location right now. Please try again or search an address.');
        return;
      }
      const detail = await locationService.reverseGeocodeDetailed(coords);
      onUpdate({
        workType: 'in_person',
        latitude: coords.latitude,
        longitude: coords.longitude,
        location: detail?.formattedAddress || 'Current location',
        neighborhood: detail?.neighborhood,
      });
      setUsedCurrentLocation(true);
    } catch {
      setError('We could not get your location right now. Please try again or search an address.');
    } finally {
      setIsLocating(false);
    }
  };

  const handleAddressChange = (value: string) => {
    setError(null);
    setUsedCurrentLocation(false);
    // Coordinates belong to the previous address — drop them so the geocode
    // below runs against what the poster actually typed.
    onUpdate({ workType: 'in_person', location: value, latitude: undefined, longitude: undefined, neighborhood: undefined });
  };

  const handleSelectOnline = () => {
    setError(null);
    setUsedCurrentLocation(false);
    // Online bounties carry no address or coordinates — bountyService drops
    // them from the payload anyway when work_type is 'online'.
    onUpdate({
      workType: 'online',
      location: '',
      latitude: undefined,
      longitude: undefined,
      neighborhood: undefined,
    });
  };

  const handleContinue = async () => {
    if (isOnline) {
      onNext();
      return;
    }

    if (draft.latitude != null && draft.longitude != null) {
      onNext();
      return;
    }

    setIsResolving(true);
    setError(null);
    try {
      const coords = await locationService.geocodeAddress(draft.location);
      if (!coords) {
        setError("We couldn't locate that address. Try a more specific address, or use your current location.");
        return;
      }
      // geocodeAddress only returns coordinates; reverse-geocode to also capture
      // the coarse locality used by the "New Bounty Near You in <city>"
      // notification. Non-fatal — coordinates are what matter.
      let neighborhood: string | undefined;
      try {
        const detail = await locationService.reverseGeocodeDetailed(coords);
        neighborhood = detail?.neighborhood || undefined;
      } catch {
        // ignore — locality is a nice-to-have
      }
      onUpdate({ latitude: coords.latitude, longitude: coords.longitude, neighborhood });
      onNext();
    } catch {
      setError('Could not verify that address right now. Check your connection and try again.');
    } finally {
      setIsResolving(false);
    }
  };

  const canContinue = isOnline || (draft.location || '').trim().length >= 3;

  return (
    <QuickStepLayout
      step={step}
      totalSteps={totalSteps}
      onBack={onBack}
      title={'Where does this\nneed to happen?'}
      ctaLabel={isResolving ? 'Locating…' : isSaving ? 'Saving…' : 'Continue'}
      ctaDisabled={!canContinue}
      ctaBusy={isResolving || isSaving}
      onCta={handleContinue}
    >
      {/* Use current location */}
      <TouchableOpacity
        onPress={handleUseCurrentLocation}
        disabled={isLocating}
        activeOpacity={0.8}
        style={[
          styles.row,
          usedCurrentLocation ? { backgroundColor: theme.isDark ? 'rgba(5,150,105,0.22)' : 'rgba(5,150,105,0.12)' } : null,
        ]}
        accessibilityRole="button"
        accessibilityLabel="Use current location"
        accessibilityState={{ selected: usedCurrentLocation }}
      >
        {isLocating ? (
          <ActivityIndicator size="small" color={theme.text} />
        ) : (
          <MaterialIcons
            name="my-location"
            size={22}
            color={usedCurrentLocation ? theme.primary : theme.text}
          />
        )}
        <Text
          style={[
            styles.rowLabel,
            { color: usedCurrentLocation ? theme.primary : theme.text },
          ]}
        >
          Use current location
        </Text>
      </TouchableOpacity>

      {/* Search address */}
      <View style={styles.row}>
        <MaterialIcons name="search" size={22} color={theme.textSecondary} />
        <TextInput
          value={usedCurrentLocation ? '' : draft.location}
          onChangeText={handleAddressChange}
          placeholder="ZIP / postal code or address"
          placeholderTextColor={theme.textSecondary}
          style={styles.input}
          autoCorrect={false}
          keyboardType="default"
          accessibilityLabel="ZIP / postal code or address"
        />
      </View>

      {usedCurrentLocation && draft.location ? (
        <Text style={styles.resolved} numberOfLines={2}>
          {draft.location}
        </Text>
      ) : null}

      {/* Online — no address needed */}
      <TouchableOpacity
        onPress={handleSelectOnline}
        activeOpacity={0.8}
        style={[
          styles.row,
          isOnline ? { backgroundColor: theme.isDark ? 'rgba(5,150,105,0.22)' : 'rgba(5,150,105,0.12)' } : null,
        ]}
        accessibilityRole="button"
        accessibilityLabel="This can be done online"
        accessibilityState={{ selected: isOnline }}
      >
        <MaterialIcons name="language" size={22} color={isOnline ? theme.primary : theme.text} />
        <Text style={[styles.rowLabel, { color: isOnline ? theme.primary : theme.text }]}>
          This can be done online
        </Text>
      </TouchableOpacity>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Text style={styles.privacy}>
        {isOnline
          ? 'Online bounties can be completed from anywhere — no address is shared.'
          : "Only your neighborhood is shown publicly. Your exact address isn't shared until you accept someone for the job."}
      </Text>
    </QuickStepLayout>
  );
}

export default StepWhere;

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      height: 64,
      borderRadius: 24,
      paddingHorizontal: 22,
      backgroundColor: theme.surfaceSecondary,
      marginBottom: 14,
    },
    rowLabel: { marginLeft: 14, fontSize: 18, fontWeight: '700' },
    input: {
      flex: 1,
      marginLeft: 14,
      fontSize: 18,
      color: theme.text,
      paddingVertical: 0,
    },
    resolved: { marginTop: 2, marginBottom: 8, fontSize: 14, color: theme.textSecondary },
    error: { marginTop: 4, fontSize: 14, color: theme.error },
    privacy: { marginTop: 20, fontSize: 13, lineHeight: 19, color: theme.textSecondary },
  });
}
