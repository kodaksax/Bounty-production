import { MaterialIcons } from '@expo/vector-icons';
import { ValidationMessage } from 'app/components/ValidationMessage';
import { useAddressLibrary } from 'app/hooks/useAddressLibrary';
import type { BountyDraft } from 'app/hooks/useBountyDraft';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AddressAutocomplete } from '../../../components/AddressAutocomplete';
import { addressAutocompleteService } from '../../../lib/services/address-autocomplete-service';
import { sanitizeAddressText } from '../../../lib/utils/address-sanitization';
import { useLocation } from 'app/hooks/useLocation';

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
  
  // Address library for saved addresses
  const { addresses } = useAddressLibrary();
  
  // Get user location for proximity-based suggestions
  const { location: currentLocation } = useLocation();

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
  
  // Handle selecting an address from autocomplete
  const handleSelectAddress = async (suggestion: any) => {
    // Fetch detailed place information to get coordinates
    try {
      const details = await addressAutocompleteService.getPlaceDetails(suggestion.placeId);
      if (details) {
        // Sanitize the formatted address before storing
        const sanitizedAddress = sanitizeAddressText(details.formattedAddress);
        onUpdate({ 
          location: sanitizedAddress,
        });
        setTouched({ ...touched, location: true });
      } else {
        // If place details fetch returns null, inform user and use fallback
        Alert.alert(
          'Address Details Unavailable',
          'Could not fetch detailed information for this address. Using basic address information.',
          [{ text: 'OK' }]
        );
        const sanitizedDescription = sanitizeAddressText(suggestion.description);
        onUpdate({ location: sanitizedDescription });
        setTouched({ ...touched, location: true });
      }
    } catch (err) {
      console.error('Error fetching place details:', err);
      // Inform user of the error and use fallback
      Alert.alert(
        'Connection Issue',
        'Could not fetch detailed address information. Using basic address.',
        [{ text: 'OK' }]
      );
      // Fallback to using the sanitized description
      const sanitizedDescription = sanitizeAddressText(suggestion.description);
      onUpdate({ location: sanitizedDescription });
      setTouched({ ...touched, location: true });
    }
  };

  const handleNext = () => {
    const locationError = validateLocation(draft.location, draft.workType);
    
    if (locationError) {
      setErrors({ location: locationError });
      setTouched({ location: true });
      return;
    }

    onNext();
  };

  const isValid = draft.workType === 'online' || !validateLocation(draft.location, draft.workType);

  const scrollRef = useRef<any>(null)
  useEffect(() => {
    const t = setTimeout(() => scrollRef.current?.scrollTo?.({ y: 0, animated: false }), 50)
    return () => clearTimeout(t)
  }, [])

  return (
    <View className="flex-1 bg-emerald-600">
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
          <Text className="text-emerald-100 text-base font-semibold mb-3">
            Where will the work be done? *
          </Text>
          <View className="flex-row gap-3">
            <TouchableOpacity
              onPress={() => handleWorkTypeChange('in_person')}
              className={`flex-1 p-4 rounded-lg border-2 ${
                draft.workType === 'in_person'
                  ? 'bg-emerald-400 border-emerald-400'
                  : 'bg-emerald-700/50 border-emerald-500/50'
              }`}
              accessibilityLabel="In person work"
              accessibilityRole="button"
              accessibilityState={{ selected: draft.workType === 'in_person' }}
            >
              <View className="items-center">
                <MaterialIcons
                  name="place"
                  size={32}
                  color={draft.workType === 'in_person' ? '#065f46' : '#fff'}
                />
                <Text
                  className={`mt-2 font-semibold ${
                    draft.workType === 'in_person' ? 'text-emerald-900' : 'text-white'
                  }`}
                >
                  In Person
                </Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => handleWorkTypeChange('online')}
              className={`flex-1 p-4 rounded-lg border-2 ${
                draft.workType === 'online'
                  ? 'bg-emerald-400 border-emerald-400'
                  : 'bg-emerald-700/50 border-emerald-500/50'
              }`}
              accessibilityLabel="Online work"
              accessibilityRole="button"
              accessibilityState={{ selected: draft.workType === 'online' }}
            >
              <View className="items-center">
                <MaterialIcons
                  name="language"
                  size={32}
                  color={draft.workType === 'online' ? '#065f46' : '#fff'}
                />
                <Text
                  className={`mt-2 font-semibold ${
                    draft.workType === 'online' ? 'text-emerald-900' : 'text-white'
                  }`}
                >
                  Online
                </Text>
              </View>
            </TouchableOpacity>
          </View>
        </View>

        {/* Location Input (only for in-person) */}
        {draft.workType === 'in_person' && (
          <View className="mb-6">
            <Text className="text-emerald-100 text-base font-semibold mb-2">
              Location *
            </Text>
            
            {/* Address Autocomplete Component */}
            <AddressAutocomplete
              value={draft.location}
              onChangeText={handleLocationChange}
              onSelectAddress={handleSelectAddress}
              onBlur={handleLocationBlur}
              placeholder="e.g., San Francisco, CA or 123 Main St"
              minChars={2}
              debounceMs={500}
              showSavedAddresses={true}
              savedAddresses={addresses}
              userLocation={currentLocation || undefined}
              searchRadius={50000}
              countryCode="us"
            />
            
            {touched.location && errors.location && (
              <ValidationMessage message={errors.location} />
            )}
            
            <View className="mt-3 bg-emerald-700/20 rounded-lg p-3 border border-emerald-500/30">
              <View className="flex-row items-start">
                <MaterialIcons
                  name="info-outline"
                  size={16}
                  color="rgba(110, 231, 183, 0.8)"
                  style={{ marginRight: 6, marginTop: 2 }}
                />
                <Text className="text-emerald-200/70 text-xs flex-1">
                  Your exact address won't be shared until you accept someone for the job. Start typing to see suggestions from Google Places and your saved addresses.
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* Remote Work Info */}
        {draft.workType === 'online' && (
          <View className="mb-6 bg-emerald-700/20 rounded-lg p-4 border border-emerald-500/30">
            <View className="flex-row items-start">
              <MaterialIcons
                name="cloud"
                size={20}
                color="rgba(110, 231, 183, 0.8)"
                style={{ marginRight: 8, marginTop: 2 }}
              />
              <View className="flex-1">
                <Text className="text-emerald-100 font-semibold mb-1">
                  Remote Work
                </Text>
                <Text className="text-emerald-200/70 text-sm">
                  This bounty can be completed from anywhere. Perfect for digital tasks!
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* Visibility Info */}
        <View className="mb-6">
          <Text className="text-emerald-100 text-base font-semibold mb-3">
            Who can see this bounty?
          </Text>
          <View className="bg-emerald-700/20 rounded-lg p-4 border border-emerald-500/30">
            <View className="flex-row items-start mb-3">
              <MaterialIcons
                name="public"
                size={20}
                color="rgba(110, 231, 183, 0.8)"
                style={{ marginRight: 8, marginTop: 2 }}
              />
              <View className="flex-1">
                <Text className="text-emerald-100 font-semibold">Public</Text>
                <Text className="text-emerald-200/70 text-sm mt-1">
                  Your bounty will be visible to all users
                  {draft.workType === 'in_person' && ' in your area'}
                </Text>
              </View>
            </View>
            <Text className="text-emerald-200/60 text-xs">
              Future updates will add options for private bounties and targeted visibility.
            </Text>
          </View>
        </View>
      </ScrollView>

      {/* Navigation Buttons */}
      <View
        className="px-4 pb-4 pt-3 bg-emerald-600 border-t border-emerald-700/50"
        style={{ marginBottom: BOTTOM_NAV_OFFSET + Math.max(insets.bottom, 8) }}
      >
        <View className="flex-row gap-3">
          <TouchableOpacity
            onPress={onBack}
            className="flex-1 bg-emerald-700/50 py-3 rounded-lg flex-row items-center justify-center"
            accessibilityLabel="Go back"
            accessibilityRole="button"
          >
            <MaterialIcons name="arrow-back" size={20} color="#fff" />
            <Text className="text-white font-semibold ml-2">Back</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleNext}
            disabled={!isValid}
            className={`flex-1 py-3 rounded-lg flex-row items-center justify-center ${
              isValid ? 'bg-emerald-500' : 'bg-emerald-700/30'
            }`}
            accessibilityLabel="Continue to next step"
            accessibilityRole="button"
            accessibilityState={{ disabled: !isValid }}
          >
            <Text
              className={`font-semibold mr-2 ${
                isValid ? 'text-white' : 'text-emerald-400/40'
              }`}
            >
              Next
            </Text>
            <MaterialIcons
              name="arrow-forward"
              size={20}
              color={isValid ? '#fff' : 'rgba(110, 231, 183, 0.4)'}
            />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

export default StepLocation;
