import { MaterialIcons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type TextInputProps,
} from 'react-native';
import { addressAutocompleteService, type AddressSuggestion } from '../lib/services/address-autocomplete-service';

interface AddressAutocompleteProps extends Omit<TextInputProps, 'onChangeText'> {
  value: string;
  onChangeText: (text: string) => void;
  onSelectAddress?: (suggestion: AddressSuggestion) => void;
  onFetchDetails?: (placeId: string) => Promise<void>;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  suggestionsClassName?: string;
  disabled?: boolean;
  minChars?: number;
  debounceMs?: number;
  showSavedAddresses?: boolean;
  savedAddresses?: Array<{ id: string; label: string; address: string }>;
  userLocation?: { latitude: number; longitude: number };
  searchRadius?: number;
  countryCode?: string; // e.g., 'us' for United States
}

/**
 * AddressAutocomplete Component
 * 
 * A reusable address autocomplete component that integrates with Google Places API.
 * Provides real-time address suggestions as the user types.
 * 
 * @example
 * ```tsx
 * <AddressAutocomplete
 *   value={address}
 *   onChangeText={setAddress}
 *   onSelectAddress={(suggestion) => {
 *     setAddress(suggestion.description);
 *   }}
 *   placeholder="Enter address"
 *   minChars={3}
 *   debounceMs={500}
 * />
 * ```
 */
export function AddressAutocomplete({
  value,
  onChangeText,
  onSelectAddress,
  onFetchDetails,
  placeholder = 'Enter address',
  className,
  inputClassName,
  suggestionsClassName,
  disabled = false,
  minChars = 2,
  debounceMs = 500,
  showSavedAddresses = false,
  savedAddresses = [],
  userLocation,
  searchRadius = 50000, // 50km default
  countryCode,
  ...inputProps
}: AddressAutocompleteProps) {
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceTimer = useRef<NodeJS.Timeout | null>(null);
  const isConfigured = addressAutocompleteService.isConfigured();

  // Fetch address suggestions with debouncing
  const fetchSuggestions = useCallback(
    async (query: string) => {
      if (!isConfigured) {
        return;
      }

      if (!query || query.trim().length < minChars) {
        setSuggestions([]);
        setShowSuggestions(false);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const results = await addressAutocompleteService.searchAddresses(query, {
          latitude: userLocation?.latitude,
          longitude: userLocation?.longitude,
          radius: searchRadius,
          types: ['address'], // Removed deprecated 'geocode' type
          components: countryCode ? `country:${countryCode}` : undefined,
        });

        setSuggestions(results);
        setShowSuggestions(results.length > 0);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to fetch suggestions';
        setError(message);
        console.error('Address autocomplete error:', err);
      } finally {
        setIsLoading(false);
      }
    },
    [isConfigured, minChars, userLocation, searchRadius, countryCode]
  );

  // Handle text change with debouncing
  const handleTextChange = useCallback(
    (text: string) => {
      onChangeText(text);

      // Clear existing timer
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }

      // Set new timer
      debounceTimer.current = setTimeout(() => {
        fetchSuggestions(text);
      }, debounceMs);
    },
    [onChangeText, fetchSuggestions, debounceMs]
  );

  // Handle suggestion selection
  const handleSelectSuggestion = useCallback(
    async (suggestion: AddressSuggestion) => {
      onChangeText(suggestion.description);
      setShowSuggestions(false);
      setSuggestions([]);

      // Notify parent
      if (onSelectAddress) {
        onSelectAddress(suggestion);
      }

      // Fetch detailed place information if requested
      if (onFetchDetails) {
        try {
          await onFetchDetails(suggestion.placeId);
        } catch (err) {
          console.error('Error fetching place details:', err);
        }
      }
    },
    [onChangeText, onSelectAddress, onFetchDetails]
  );

  // Handle saved address selection
  const handleSelectSavedAddress = useCallback(
    (address: { id: string; label: string; address: string }) => {
      onChangeText(address.address);
      setShowSuggestions(false);
    },
    [onChangeText]
  );

  // Filter saved addresses based on input
  const filteredSavedAddresses = savedAddresses.filter(
    (addr) =>
      value.length >= 2 &&
      (addr.label.toLowerCase().includes(value.toLowerCase()) ||
        addr.address.toLowerCase().includes(value.toLowerCase()))
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, []);

  return (
    <View className={className}>
      {/* Text Input */}
      <View className="relative">
        <TextInput
          value={value}
          onChangeText={handleTextChange}
          onFocus={() => {
            if (value.length >= minChars) {
              fetchSuggestions(value);
            }
          }}
          placeholder={placeholder}
          placeholderTextColor="rgba(110, 231, 183, 0.4)"
          className={`bg-emerald-700/50 text-white px-4 py-3 rounded-lg text-base ${inputClassName || ''}`}
          editable={!disabled}
          accessibilityLabel="Address input"
          accessibilityHint="Type to search for addresses"
          accessibilityRole="search"
          {...inputProps}
        />
        {isLoading && (
          <View className="absolute right-4 top-3">
            <ActivityIndicator size="small" color="#6ee7b7" />
          </View>
        )}
      </View>

      {/* Configuration Warning */}
      {!isConfigured && value.length >= minChars && (
        <View className="mt-2 bg-amber-900/30 rounded-lg p-3 border border-amber-700/50">
          <View className="flex-row items-start">
            <MaterialIcons
              name="warning"
              size={16}
              color="rgba(251, 191, 36, 0.8)"
              style={{ marginRight: 6, marginTop: 2 }}
            />
            <Text className="text-amber-200/80 text-xs flex-1">
              Address autocomplete is not configured. Please add your Google Places API key.
            </Text>
          </View>
        </View>
      )}

      {/* Error Message */}
      {error && (
        <View className="mt-2 bg-red-900/30 rounded-lg p-3 border border-red-700/50">
          <View className="flex-row items-start">
            <MaterialIcons
              name="error-outline"
              size={16}
              color="rgba(252, 165, 165, 0.8)"
              style={{ marginRight: 6, marginTop: 2 }}
            />
            <Text className="text-red-200/80 text-xs flex-1">{error}</Text>
          </View>
        </View>
      )}

      {/* Suggestions List */}
      {(showSuggestions || (showSavedAddresses && filteredSavedAddresses.length > 0)) && (
        <View
          className={`mt-2 bg-emerald-700/50 rounded-lg border border-emerald-500/50 overflow-hidden ${suggestionsClassName || ''}`}
        >
          {/* Saved Addresses Section */}
          {showSavedAddresses && filteredSavedAddresses.length > 0 && (
            <>
              <View className="px-3 py-2 bg-emerald-800/30 border-b border-emerald-500/30">
                <Text className="text-emerald-200/80 text-xs font-semibold">
                  Saved Addresses
                </Text>
              </View>
              <FlatList
                data={filteredSavedAddresses}
                keyExtractor={(item) => `saved-${item.id}`}
                scrollEnabled={false}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    onPress={() => handleSelectSavedAddress(item)}
                    className="px-3 py-3 border-b border-emerald-500/20 flex-row items-center"
                    accessibilityLabel={`Select saved address: ${item.label}`}
                    accessibilityRole="button"
                  >
                    <MaterialIcons
                      name="bookmark"
                      size={18}
                      color="rgba(110, 231, 183, 0.7)"
                      style={{ marginRight: 10 }}
                    />
                    <View className="flex-1">
                      <Text className="text-white font-semibold text-sm mb-1">
                        {item.label}
                      </Text>
                      <Text className="text-emerald-200/70 text-xs" numberOfLines={1}>
                        {item.address}
                      </Text>
                    </View>
                  </TouchableOpacity>
                )}
              />
            </>
          )}

          {/* API Suggestions Section */}
          {isConfigured && suggestions.length > 0 && (
            <>
              {showSavedAddresses && filteredSavedAddresses.length > 0 && (
                <View className="px-3 py-2 bg-emerald-800/30 border-b border-emerald-500/30">
                  <Text className="text-emerald-200/80 text-xs font-semibold">
                    Suggested Addresses
                  </Text>
                </View>
              )}
              <FlatList
                data={suggestions}
                keyExtractor={(item) => item.id}
                scrollEnabled={false}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    onPress={() => handleSelectSuggestion(item)}
                    className="px-3 py-3 border-b border-emerald-500/20 flex-row items-center"
                    accessibilityLabel={`Select address: ${item.description}`}
                    accessibilityRole="button"
                  >
                    <MaterialIcons
                      name="place"
                      size={18}
                      color="rgba(110, 231, 183, 0.7)"
                      style={{ marginRight: 10 }}
                    />
                    <View className="flex-1">
                      <Text className="text-white font-semibold text-sm">
                        {item.mainText}
                      </Text>
                      {item.secondaryText && (
                        <Text className="text-emerald-200/70 text-xs mt-0.5">
                          {item.secondaryText}
                        </Text>
                      )}
                    </View>
                  </TouchableOpacity>
                )}
              />
            </>
          )}
        </View>
      )}
    </View>
  );
}

export default AddressAutocomplete;
