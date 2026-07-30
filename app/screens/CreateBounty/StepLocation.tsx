import { MaterialIcons } from '@expo/vector-icons';
import { ValidationMessage } from 'app/components/ValidationMessage';
import { useAddressLibrary } from 'app/hooks/useAddressLibrary';
import type { BountyDraft } from 'app/hooks/useBountyDraft';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppThemeContext } from '../../../lib/themes/AppThemeContext';
import { LocationPickerMap, type LocationPickerValue } from '../../../components/location/LocationPickerMap';
import { locationService } from '../../../lib/services/location-service';

interface StepLocationProps {
  draft: BountyDraft;
  onUpdate: (data: Partial<BountyDraft>) => void;
  onNext: () => void;
  onBack: () => void;
}

export function StepLocation({ draft, onUpdate, onNext, onBack }: StepLocationProps) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const insets = useSafeAreaInsets();
  const BOTTOM_NAV_OFFSET = 60;
  const { theme } = useAppThemeContext();

  // Address library for saved addresses
  const { addresses, addAddress } = useAddressLibrary();
  const [isSavingFavorite, setIsSavingFavorite] = useState(false);
  // True while forward-geocoding a typed (un-selected) address on Next.
  const [isResolvingLocation, setIsResolvingLocation] = useState(false);

  const validateLocation = (location: string, workType: string): string | null => {
    if (workType === 'in_person') {
      if (!location || location.trim().length === 0) {
        return 'Location is required for in-person work';
      }
      if (location.length < 3) {
        return 'Location must be at least 3 characters';
      }
    }
    return null;
  };

  const handleWorkTypeChange = (type: 'online' | 'in_person') => {
    onUpdate({ workType: type });
    if (type === 'online') {
      setErrors({});
      setTouched({});
    }
  };

  const handleLocationChange = (value: string) => {
    onUpdate({ location: value });
    setTouched({ ...touched, location: true });
    
    // Validate on change if already touched
    if (touched.location) {
      const error = validateLocation(value, draft.workType);
      setErrors({ ...errors, location: error || '' });
    }
  };

  const handleLocationBlur = () => {
    setTouched({ ...touched, location: true });
    const error = validateLocation(draft.location, draft.workType);
    setErrors({ ...errors, location: error || '' });
  };

  const validateZipCode = (zip: string): string | null => {
    if (!zip) return null; // optional field
    if (!/^\d{5}$/.test(zip)) return 'Enter a valid 5-digit ZIP code';
    return null;
  };

  const handleZipCodeChange = (value: string) => {
    const digitsOnly = value.replace(/[^0-9]/g, '').slice(0, 5);
    onUpdate({ zipCode: digitsOnly });
    if (touched.zipCode) {
      const error = validateZipCode(digitsOnly);
      setErrors({ ...errors, zipCode: error || '' });
    }
  };

  const handleZipCodeBlur = () => {
    setTouched({ ...touched, zipCode: true });
    const error = validateZipCode(draft.zipCode || '');
    setErrors({ ...errors, zipCode: error || '' });
  };
  
  // The map picker resolves an address selection (search, drag, or current
  // location) to coordinates + neighborhood itself and reports the full
  // result here — no separate Place Details fetch needed on this screen.
  const handleLocationPicked = (value: LocationPickerValue) => {
    onUpdate({
      location: value.address,
      latitude: value.latitude,
      longitude: value.longitude,
      neighborhood: value.neighborhood,
    });
    setTouched({ ...touched, location: true });
    if (touched.location) {
      const error = validateLocation(value.address, draft.workType);
      setErrors({ ...errors, location: error || '' });
    }
  };

  const handleSaveFavorite = async () => {
    if (!draft.location || draft.latitude == null || draft.longitude == null) {
      Alert.alert('Pick a location first', 'Choose an address on the map before saving it as a favorite.');
      return;
    }
    setIsSavingFavorite(true);
    try {
      const saved = await addAddress(draft.location, draft.location, {
        unit: draft.unit,
        latitude: draft.latitude,
        longitude: draft.longitude,
      });
      if (saved) {
        Alert.alert('Saved', 'This location was added to your favorites.');
      } else {
        Alert.alert('Could not save', 'Something went wrong saving this favorite. Please try again.');
      }
    } finally {
      setIsSavingFavorite(false);
    }
  };

  const handleNext = async () => {
    const locationError = validateLocation(draft.location, draft.workType);
    const zipCodeError = validateZipCode(draft.zipCode || '');

    if (locationError || zipCodeError) {
      setErrors({ location: locationError || '', zipCode: zipCodeError || '' });
      setTouched({ ...touched, location: true, zipCode: true });
      return;
    }

    // In-person bounties must carry coordinates so nearby hunters can be matched
    // (hunter_service_areas proximity notifications + the feed's radius search).
    // The map picker sets lat/lng when the poster taps a suggestion, drops the
    // pin, or uses current location — but NOT when they only type an address.
    // Previously a typed-only address advanced with no coordinates, so the
    // bounty was saved without a geom and never matched anyone. Forward-geocode
    // the typed text here; block posting if it can't be resolved.
    if (draft.workType === 'in_person' && (draft.latitude == null || draft.longitude == null)) {
      setIsResolvingLocation(true);
      try {
        const coords = await locationService.geocodeAddress(draft.location);
        if (!coords) {
          setErrors({
            ...errors,
            location:
              "We couldn't locate that address. Pick a suggestion from the list or drop the pin on the map.",
          });
          setTouched({ ...touched, location: true });
          return;
        }
        onUpdate({ latitude: coords.latitude, longitude: coords.longitude });
      } catch {
        setErrors({
          ...errors,
          location:
            'Could not verify that address right now. Check your connection, or drop the pin on the map.',
        });
        setTouched({ ...touched, location: true });
        return;
      } finally {
        setIsResolvingLocation(false);
      }
    }

    onNext();
  };

  const isValid =
    (draft.workType === 'online' || !validateLocation(draft.location, draft.workType)) &&
    !validateZipCode(draft.zipCode || '');

  const scrollRef = useRef<any>(null)
  useEffect(() => {
    const t = setTimeout(() => scrollRef.current?.scrollTo?.({ y: 0, animated: false }), 50)
    return () => clearTimeout(t)
  }, [])

  return (
    <View className="flex-1" style={{ backgroundColor: theme.background }}>
      <ScrollView
        ref={scrollRef}
        className="flex-1 px-4 pt-2"
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled={true}
        removeClippedSubviews={false}
        scrollEnabled={true}
        bounces={true}
        showsVerticalScrollIndicator={true}
        contentContainerStyle={{ flexGrow: 1, paddingBottom: BOTTOM_NAV_OFFSET + Math.max(insets.bottom, 12) + 16 }}
      >
        {/* Work Type Selection */}
        <View className="mb-6">
          <Text className="text-base font-semibold mb-3" style={{ color: theme.text }}>
            Where will the work be done? *
          </Text>
          <View className="flex-row gap-3">
            <TouchableOpacity
              onPress={() => handleWorkTypeChange('in_person')}
              className="flex-1 p-4 rounded-lg border-2"
              style={{
                backgroundColor: draft.workType === 'in_person' ? theme.primary : theme.surfaceSecondary,
                borderColor: draft.workType === 'in_person' ? theme.primary : theme.border,
              }}
              accessibilityLabel="In person work"
              accessibilityRole="button"
              accessibilityState={{ selected: draft.workType === 'in_person' }}
            >
              <View className="items-center">
                <MaterialIcons
                  name="place"
                  size={32}
                  color={draft.workType === 'in_person' ? '#fff' : theme.textDisabled}
                />
                <Text className="mt-2 font-semibold" style={{ color: draft.workType === 'in_person' ? '#fff' : theme.text }}>
                  In Person
                </Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => handleWorkTypeChange('online')}
              className="flex-1 p-4 rounded-lg border-2"
              style={{
                backgroundColor: draft.workType === 'online' ? theme.primary : theme.surfaceSecondary,
                borderColor: draft.workType === 'online' ? theme.primary : theme.border,
              }}
              accessibilityLabel="Online work"
              accessibilityRole="button"
              accessibilityState={{ selected: draft.workType === 'online' }}
            >
              <View className="items-center">
                <MaterialIcons
                  name="language"
                  size={32}
                  color={draft.workType === 'online' ? '#fff' : theme.textDisabled}
                />
                <Text className="mt-2 font-semibold" style={{ color: draft.workType === 'online' ? '#fff' : theme.text }}>
                  Online
                </Text>
              </View>
            </TouchableOpacity>
          </View>
        </View>

        {/* Location Input (only for in-person) */}
        {draft.workType === 'in_person' && (
          <View className="mb-6">
            <Text className="text-base font-semibold mb-2" style={{ color: theme.text }}>
              Location *
            </Text>
            
            {/* Address Autocomplete Component */}
            <LocationPickerMap
              latitude={draft.latitude}
              longitude={draft.longitude}
              address={draft.location}
              unit={draft.unit}
              onChange={handleLocationPicked}
              onAddressTextChange={handleLocationChange}
              onUnitChange={(unit) => onUpdate({ unit })}
              savedLocations={addresses}
              onSelectSavedLocation={(loc) =>
                onUpdate({
                  location: loc.address,
                  unit: loc.unit,
                  latitude: loc.latitude,
                  longitude: loc.longitude,
                })
              }
            />

            {touched.location && errors.location && (
              <ValidationMessage message={errors.location} />
            )}

            <TouchableOpacity
              onPress={handleSaveFavorite}
              disabled={isSavingFavorite}
              className="mt-3 flex-row items-center justify-center py-2 rounded-lg border"
              style={{ borderColor: theme.border }}
              accessibilityRole="button"
              accessibilityLabel="Save this location as a favorite"
            >
              <MaterialIcons name="star-outline" size={16} color={theme.primary} />
              <Text className="ml-2 text-sm font-semibold" style={{ color: theme.primary }}>
                Save to favorites
              </Text>
            </TouchableOpacity>

            <View className="mt-3 rounded-lg p-3 border" style={{ backgroundColor: theme.surface, borderColor: theme.border }}>
              <View className="flex-row items-start">
                <MaterialIcons
                  name="info-outline"
                  size={16}
                  color={theme.primaryLight}
                  style={{ marginRight: 6, marginTop: 2 }}
                />
                <Text className="text-xs flex-1" style={{ color: theme.textSecondary }}>
                  Only your neighborhood is shown publicly. Your exact address won
                  {"'"}
                  t be shared until you accept someone for the job.
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* Remote Work Info */}
        {draft.workType === 'online' && (
          <View className="mb-6 rounded-lg p-4 border" style={{ backgroundColor: theme.surface, borderColor: theme.border }}>
            <View className="flex-row items-start">
              <MaterialIcons
                name="cloud"
                size={20}
                color={theme.primaryLight}
                style={{ marginRight: 8, marginTop: 2 }}
              />
              <View className="flex-1">
                <Text className="font-semibold mb-1" style={{ color: theme.text }}>
                  Remote Work
                </Text>
                <Text className="text-sm" style={{ color: theme.textSecondary }}>
                  This bounty can be completed from anywhere. Perfect for digital tasks!
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* Visibility Info */}
        <View className="mb-6">
          <Text className="text-base font-semibold mb-3" style={{ color: theme.text }}>
            Who can see this bounty?
          </Text>
          <View className="rounded-lg p-4 border" style={{ backgroundColor: theme.surface, borderColor: theme.border }}>
            <View className="flex-row items-start mb-3">
              <MaterialIcons
                name="public"
                size={20}
                color={theme.primaryLight}
                style={{ marginRight: 8, marginTop: 2 }}
              />
              <View className="flex-1">
                <Text className="font-semibold" style={{ color: theme.text }}>Public</Text>
                <Text className="text-sm mt-1" style={{ color: theme.textSecondary }}>
                  Your bounty will be visible to all users
                  {draft.workType === 'in_person' && ' in your area'}
                </Text>
              </View>
            </View>
            <Text className="text-xs" style={{ color: theme.textSecondary }}>
              Future updates will add options for private bounties and targeted visibility.
            </Text>
          </View>
        </View>

        {/* ZIP Code (optional) */}
        <View className="mb-6">
          <Text className="text-base font-semibold mb-2" style={{ color: theme.text }}>
            ZIP Code (optional)
          </Text>
          <TextInput
            value={draft.zipCode || ''}
            onChangeText={handleZipCodeChange}
            onBlur={handleZipCodeBlur}
            placeholder="e.g., 94103"
            placeholderTextColor={theme.textDisabled}
            keyboardType="number-pad"
            maxLength={5}
            className="px-4 py-3 rounded-lg text-base"
            style={{ backgroundColor: theme.surfaceSecondary, color: theme.text }}
            accessibilityLabel="ZIP code input"
          />
          {touched.zipCode && errors.zipCode && (
            <ValidationMessage message={errors.zipCode} />
          )}
          <Text className="text-xs mt-1" style={{ color: theme.textSecondary }}>
            Helps us match this bounty to nearby users who list the same ZIP on their profile.
          </Text>
        </View>
      </ScrollView>

      {/* Navigation Buttons */}
      <View
        className="px-4 pb-4 pt-3 border-t"
        style={{ backgroundColor: theme.background, borderColor: theme.border, marginBottom: BOTTOM_NAV_OFFSET + Math.max(insets.bottom, 8) }}
      >
        <View className="flex-row gap-3">
          <TouchableOpacity
            onPress={onBack}
            className="flex-1 py-3 rounded-lg flex-row items-center justify-center"
            style={{ backgroundColor: theme.surfaceSecondary }}
            accessibilityLabel="Go back"
            accessibilityRole="button"
          >
            <MaterialIcons name="arrow-back" size={20} color={theme.text} />
            <Text className="font-semibold ml-2" style={{ color: theme.text }}>Back</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleNext}
            disabled={!isValid || isResolvingLocation}
            className="flex-1 py-3 rounded-lg flex-row items-center justify-center"
            style={{ backgroundColor: isValid && !isResolvingLocation ? theme.primary : theme.surface }}
            accessibilityLabel="Continue to next step"
            accessibilityRole="button"
            accessibilityState={{ disabled: !isValid || isResolvingLocation, busy: isResolvingLocation }}
          >
            <Text
              className="font-semibold mr-2"
              style={{ color: isValid && !isResolvingLocation ? '#fff' : theme.textDisabled }}
            >
              {isResolvingLocation ? 'Locating…' : 'Next'}
            </Text>
            <MaterialIcons
              name={isResolvingLocation ? 'hourglass-empty' : 'arrow-forward'}
              size={20}
              color={isValid && !isResolvingLocation ? '#fff' : theme.textDisabled}
            />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

export default StepLocation;
