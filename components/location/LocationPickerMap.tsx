import { MaterialIcons } from '@expo/vector-icons';
import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Text, TextInput, TouchableOpacity, View } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import { AddressAutocomplete } from '../AddressAutocomplete';
import { addressAutocompleteService, isPlaceDetailsError, type AddressSuggestion } from '../../lib/services/address-autocomplete-service';
import { locationService } from '../../lib/services/location-service';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import { sanitizeAddressText } from '../../lib/utils/address-sanitization';
import type { SavedAddress } from '../../lib/types';

// Continental US centroid — used only when the caller has no coordinates and
// no device location yet (first-open, permission not granted). Purely a map
// starting viewport, never persisted as the actual pin location.
const FALLBACK_REGION: Region = {
  latitude: 39.8283,
  longitude: -98.5795,
  latitudeDelta: 30,
  longitudeDelta: 30,
};

const PIN_REGION_DELTA = 0.01;

export interface LocationPickerValue {
  latitude: number;
  longitude: number;
  address: string;
  neighborhood?: string;
}

interface LocationPickerMapProps {
  latitude?: number;
  longitude?: number;
  address?: string;
  unit?: string;
  onChange: (value: LocationPickerValue) => void;
  onAddressTextChange?: (text: string) => void;
  onUnitChange?: (unit: string) => void;
  /** Pin-only mode hides the address search bar and unit field — used for the hunter work-radius picker. */
  mode?: 'full' | 'pin-only';
  savedLocations?: SavedAddress[];
  onSelectSavedLocation?: (loc: SavedAddress) => void;
  height?: number;
}

export function LocationPickerMap({
  latitude,
  longitude,
  address = '',
  unit = '',
  onChange,
  onAddressTextChange,
  onUnitChange,
  mode = 'full',
  savedLocations = [],
  onSelectSavedLocation,
  height = 260,
}: LocationPickerMapProps) {
  const { theme } = useAppThemeContext();
  const mapRef = useRef<MapView>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [isResolvingPin, setIsResolvingPin] = useState(false);

  const hasPin = latitude != null && longitude != null;
  const region: Region = hasPin
    ? { latitude: latitude!, longitude: longitude!, latitudeDelta: PIN_REGION_DELTA, longitudeDelta: PIN_REGION_DELTA }
    : FALLBACK_REGION;

  const animateTo = useCallback((lat: number, lng: number) => {
    mapRef.current?.animateToRegion(
      { latitude: lat, longitude: lng, latitudeDelta: PIN_REGION_DELTA, longitudeDelta: PIN_REGION_DELTA },
      350
    );
  }, []);

  const handleDragEnd = useCallback(
    async (e: { nativeEvent: { coordinate: { latitude: number; longitude: number } } }) => {
      const { latitude: lat, longitude: lng } = e.nativeEvent.coordinate;
      setIsResolvingPin(true);
      try {
        const resolved = await locationService.reverseGeocodeDetailed({ latitude: lat, longitude: lng });
        onChange({
          latitude: lat,
          longitude: lng,
          address: resolved?.formattedAddress || address,
          neighborhood: resolved?.neighborhood,
        });
      } finally {
        setIsResolvingPin(false);
      }
    },
    [address, onChange]
  );

  const handleUseCurrentLocation = useCallback(async () => {
    setIsLocating(true);
    try {
      const permission = await locationService.getPermissionStatus();
      const granted = permission.granted || (await locationService.requestPermission()).granted;
      if (!granted) return;

      const loc = await locationService.getCurrentLocation();
      if (!loc) return;

      animateTo(loc.latitude, loc.longitude);
      const resolved = await locationService.reverseGeocodeDetailed(loc);
      onChange({
        latitude: loc.latitude,
        longitude: loc.longitude,
        address: resolved?.formattedAddress || address,
        neighborhood: resolved?.neighborhood,
      });
    } finally {
      setIsLocating(false);
    }
  }, [address, animateTo, onChange]);

  const handleSelectAddress = useCallback(
    async (suggestion: AddressSuggestion) => {

      onAddressTextChange?.(sanitizeAddressText(suggestion.description));
      const response = await addressAutocompleteService.getPlaceDetails(suggestion.placeId);
      if (isPlaceDetailsError(response) || response.latitude == null || response.longitude == null) {
        console.log('DOESNT WORAAAAAAA')
        return;
      }
      animateTo(response.latitude, response.longitude);
      onChange({
        latitude: response.latitude,
        longitude: response.longitude,
        address: sanitizeAddressText(response.formattedAddress),
        neighborhood: response.components?.neighborhood || response.components?.city,
      });
    },
    [animateTo, onChange, onAddressTextChange]
  );

  const handleSelectSaved = useCallback(
    (loc: SavedAddress) => {
      onSelectSavedLocation?.(loc);
      if (loc.latitude != null && loc.longitude != null) {
        animateTo(loc.latitude, loc.longitude);
      }
    },
    [animateTo, onSelectSavedLocation]
  );

  return (
    <View>
      {mode === 'full' && (
        <View style={{ marginBottom: 10 }}>
          <AddressAutocomplete
            value={address}
            onChangeText={(text) => onAddressTextChange?.(text)}
            onSelectAddress={handleSelectAddress}
            placeholder="Search an address"
            minChars={2}
            debounceMs={500}
            showSavedAddresses={savedLocations.length > 0}
            savedAddresses={savedLocations}
            userLocation={hasPin ? { latitude: latitude!, longitude: longitude! } : undefined}
            searchRadius={50000}
            countryCode="us"
          />
        </View>
      )}

      {mode === 'full' && savedLocations.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
          {savedLocations.map((loc) => (
            <TouchableOpacity
              key={loc.id}
              onPress={() => handleSelectSaved(loc)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: 10,
                paddingVertical: 6,
                borderRadius: 999,
                backgroundColor: theme.surfaceSecondary,
                borderWidth: 1,
                borderColor: theme.border,
              }}
              accessibilityRole="button"
              accessibilityLabel={`Use saved location ${loc.label}`}
            >
              <MaterialIcons name="star" size={14} color={theme.primary} style={{ marginRight: 4 }} />
              <Text style={{ color: theme.text, fontSize: 12, fontWeight: '600' }}>{loc.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <View style={{ height, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: theme.border }}>
        <MapView
          ref={mapRef}
          provider={PROVIDER_GOOGLE}
          style={{ flex: 1 }}
          initialRegion={region}
          region={hasPin ? region : undefined}
          onPress={(e) => handleDragEnd(e as any)}
        >
          {hasPin && (
            <Marker
              coordinate={{ latitude: latitude!, longitude: longitude! }}
              draggable
              onDragEnd={handleDragEnd}
              tracksViewChanges={false}
            />
          )}
        </MapView>

        {(isLocating || isResolvingPin) && (
          <View
            style={{
              position: 'absolute', top: 8, right: 8,
              backgroundColor: theme.surface, borderRadius: 8, padding: 6,
            }}
          >
            <ActivityIndicator size="small" color={theme.primary} />
          </View>
        )}

        <TouchableOpacity
          onPress={handleUseCurrentLocation}
          disabled={isLocating}
          style={{
            position: 'absolute', bottom: 10, right: 10,
            flexDirection: 'row', alignItems: 'center',
            backgroundColor: theme.surface, borderRadius: 999,
            paddingHorizontal: 12, paddingVertical: 8,
            borderWidth: 1, borderColor: theme.border,
          }}
          accessibilityRole="button"
          accessibilityLabel="Use current location"
        >
          <MaterialIcons name="my-location" size={16} color={theme.primary} />
          <Text style={{ marginLeft: 6, color: theme.text, fontSize: 12, fontWeight: '600' }}>Current location</Text>
        </TouchableOpacity>
      </View>

      {mode === 'full' && (
        <>
          <Text style={{ marginTop: 6, fontSize: 11, color: theme.textSecondary }}>
            Drag the pin or tap the map to fine-tune the exact spot.
          </Text>
          <TextInput
            value={unit}
            onChangeText={(text) => onUnitChange?.(text)}
            placeholder="Apt, suite, or unit (optional)"
            placeholderTextColor={theme.textDisabled}
            style={{
              marginTop: 10, paddingHorizontal: 14, paddingVertical: 12,
              borderRadius: 10, fontSize: 15,
              backgroundColor: theme.surfaceSecondary, color: theme.text,
            }}
            accessibilityLabel="Apartment or unit number"
          />
        </>
      )}
    </View>
  );
}

export default LocationPickerMap;
