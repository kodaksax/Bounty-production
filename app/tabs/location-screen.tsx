import { MaterialIcons } from '@expo/vector-icons';
import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  FlatList,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocation } from '../hooks/useLocation';
import { useAddressLibrary } from '../hooks/useAddressLibrary';
import type { SavedAddress } from '../../lib/types';

const BOTTOM_NAV_OFFSET = 70;

export function LocationScreen() {
  const insets = useSafeAreaInsets();
  const {
    location,
    permission,
    isLoading: locationLoading,
    error: locationError,
    requestPermission,
  } = useLocation();

  const {
    addresses,
    isLoading: addressesLoading,
    error: addressesError,
    addAddress,
    updateAddress,
    deleteAddress,
  } = useAddressLibrary();

  const [showAddForm, setShowAddForm] = useState(false);
  const [editingAddress, setEditingAddress] = useState<SavedAddress | null>(null);
  const [formLabel, setFormLabel] = useState('');
  const [formAddress, setFormAddress] = useState('');

  const handleRequestPermission = useCallback(async () => {
    await requestPermission();
  }, [requestPermission]);

  const handleAddressSubmit = useCallback(async () => {
    if (!formLabel.trim() || !formAddress.trim()) {
      Alert.alert('Error', 'Please fill in both label and address fields');
      return;
    }

    if (editingAddress) {
      const result = await updateAddress(editingAddress.id, formLabel.trim(), formAddress.trim());
      if (result) {
        setEditingAddress(null);
        setFormLabel('');
        setFormAddress('');
        setShowAddForm(false);
      }
    } else {
      const result = await addAddress(formLabel.trim(), formAddress.trim());
      if (result) {
        setFormLabel('');
        setFormAddress('');
        setShowAddForm(false);
      }
    }
  }, [formLabel, formAddress, editingAddress, addAddress, updateAddress]);

  const handleEdit = useCallback((address: SavedAddress) => {
    setEditingAddress(address);
    setFormLabel(address.label);
    setFormAddress(address.address);
    setShowAddForm(true);
  }, []);

  const handleDelete = useCallback(
    (address: SavedAddress) => {
      Alert.alert('Delete Address', `Are you sure you want to delete "${address.label}"?`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteAddress(address.id);
          },
        },
      ]);
    },
    [deleteAddress]
  );

  const handleCancelForm = useCallback(() => {
    setShowAddForm(false);
    setEditingAddress(null);
    setFormLabel('');
    setFormAddress('');
  }, []);

  const renderAddressItem = useCallback(
    ({ item }: { item: SavedAddress }) => (
      <View className="bg-emerald-700/50 rounded-lg p-4 mb-2">
        <View className="flex-row items-start justify-between">
          <View className="flex-1 mr-3">
            <Text className="text-white font-semibold text-base mb-1">{item.label}</Text>
            <Text className="text-emerald-200 text-sm" numberOfLines={2}>
              {item.address}
            </Text>
            {item.latitude && item.longitude && (
              <Text className="text-emerald-300/60 text-xs mt-1">
                Coordinates available
              </Text>
            )}
          </View>
          <View className="flex-row gap-2">
            <TouchableOpacity
              onPress={() => handleEdit(item)}
              className="bg-emerald-600 p-2 rounded"
              accessibilityLabel={`Edit ${item.label}`}
              accessibilityRole="button"
            >
              <MaterialIcons name="edit" size={20} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => handleDelete(item)}
              className="bg-red-600 p-2 rounded"
              accessibilityLabel={`Delete ${item.label}`}
              accessibilityRole="button"
            >
              <MaterialIcons name="delete" size={20} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>
      </View>
    ),
    [handleEdit, handleDelete]
  );

  const renderEmptyAddresses = useCallback(
    () => (
      <View className="items-center justify-center py-12">
        <MaterialIcons name="place" size={64} color="rgba(110, 231, 183, 0.3)" />
        <Text className="text-emerald-200/60 text-base mt-4 text-center">
          No addresses saved yet
        </Text>
        <Text className="text-emerald-200/40 text-sm mt-2 text-center px-8">
          Add addresses to quickly fill in location fields when creating bounties
        </Text>
      </View>
    ),
    []
  );

  return (
    <View className="flex-1 bg-emerald-600">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingTop: Math.max(insets.top, 12),
          paddingBottom: BOTTOM_NAV_OFFSET + Math.max(insets.bottom, 16),
        }}
      >
        {/* Header */}
        <View className="px-4 mb-6">
          <Text className="text-white text-3xl font-bold mb-2">Location & Visibility</Text>
          <Text className="text-emerald-200/80 text-sm">
            Manage your location settings and saved addresses
          </Text>
        </View>

        {/* Location Permissions Section */}
        <View className="px-4 mb-6">
          <View className="bg-emerald-700/30 rounded-lg p-4 border border-emerald-500/30">
            <View className="flex-row items-center mb-3">
              <MaterialIcons name="my-location" size={24} color="#6ee7b7" />
              <Text className="text-white text-lg font-semibold ml-2">
                Location Permissions
              </Text>
            </View>

            {locationError && (
              <View className="bg-red-500/20 border border-red-400 rounded-lg p-3 mb-3">
                <Text className="text-red-200 text-sm">{locationError}</Text>
              </View>
            )}

            {permission ? (
              <View>
                <View className="flex-row items-center mb-2">
                  <MaterialIcons
                    name={permission.granted ? 'check-circle' : 'cancel'}
                    size={20}
                    color={permission.granted ? '#6ee7b7' : '#f87171'}
                  />
                  <Text className="text-emerald-200 ml-2">
                    Status:{' '}
                    <Text className="font-semibold">
                      {permission.granted ? 'Granted' : 'Denied'}
                    </Text>
                  </Text>
                </View>

                {location && (
                  <Text className="text-emerald-300/80 text-sm mb-3">
                    Current location: {location.latitude.toFixed(4)}, {location.longitude.toFixed(4)}
                  </Text>
                )}

                {!permission.granted && (
                  <TouchableOpacity
                    onPress={handleRequestPermission}
                    disabled={locationLoading}
                    className="bg-emerald-500 py-3 rounded-lg mt-2"
                    accessibilityLabel="Request location permission"
                    accessibilityRole="button"
                  >
                    {locationLoading ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text className="text-white text-center font-semibold">
                        {permission.canAskAgain
                          ? 'Grant Permission'
                          : 'Permission denied - Enable in Settings'}
                      </Text>
                    )}
                  </TouchableOpacity>
                )}
              </View>
            ) : (
              <ActivityIndicator color="#6ee7b7" />
            )}

            <Text className="text-emerald-200/60 text-xs mt-3">
              Location is used to calculate distances to in-person bounties and help you find
              opportunities nearby.
            </Text>
          </View>
        </View>

        {/* Saved Addresses Section */}
        <View className="px-4">
          <View className="flex-row items-center justify-between mb-3">
            <Text className="text-white text-xl font-semibold">Saved Addresses</Text>
            {!showAddForm && (
              <TouchableOpacity
                onPress={() => setShowAddForm(true)}
                className="bg-emerald-500 px-4 py-2 rounded-lg flex-row items-center"
                accessibilityLabel="Add new address"
                accessibilityRole="button"
              >
                <MaterialIcons name="add" size={20} color="#fff" />
                <Text className="text-white font-semibold ml-1">Add</Text>
              </TouchableOpacity>
            )}
          </View>

          {addressesError && (
            <View className="bg-red-500/20 border border-red-400 rounded-lg p-3 mb-3">
              <Text className="text-red-200 text-sm">{addressesError}</Text>
            </View>
          )}

          {/* Add/Edit Form */}
          {showAddForm && (
            <View className="bg-emerald-700/50 rounded-lg p-4 mb-4 border border-emerald-500/50">
              <Text className="text-white text-lg font-semibold mb-3">
                {editingAddress ? 'Edit Address' : 'Add New Address'}
              </Text>

              <Text className="text-emerald-200 text-sm mb-1">Label</Text>
              <TextInput
                value={formLabel}
                onChangeText={setFormLabel}
                placeholder="e.g., Home, Office, Studio"
                placeholderTextColor="rgba(110, 231, 183, 0.4)"
                className="bg-emerald-800/50 text-white px-4 py-3 rounded-lg mb-3"
              />

              <Text className="text-emerald-200 text-sm mb-1">Address</Text>
              <TextInput
                value={formAddress}
                onChangeText={setFormAddress}
                placeholder="Full address (e.g., 123 Main St, City, State)"
                placeholderTextColor="rgba(110, 231, 183, 0.4)"
                className="bg-emerald-800/50 text-white px-4 py-3 rounded-lg mb-3"
                multiline
                numberOfLines={2}
              />

              <View className="flex-row gap-2">
                <TouchableOpacity
                  onPress={handleCancelForm}
                  className="flex-1 bg-emerald-700/50 py-3 rounded-lg"
                  accessibilityLabel="Cancel"
                  accessibilityRole="button"
                >
                  <Text className="text-white text-center font-semibold">Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleAddressSubmit}
                  className="flex-1 bg-emerald-500 py-3 rounded-lg"
                  accessibilityLabel={editingAddress ? 'Update address' : 'Save address'}
                  accessibilityRole="button"
                >
                  <Text className="text-white text-center font-semibold">
                    {editingAddress ? 'Update' : 'Save'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Address List */}
          {addressesLoading ? (
            <View className="py-8">
              <ActivityIndicator size="large" color="#6ee7b7" />
            </View>
          ) : (
            <FlatList
              data={addresses}
              renderItem={renderAddressItem}
              keyExtractor={(item) => item.id}
              scrollEnabled={false}
              ListEmptyComponent={renderEmptyAddresses}
            />
          )}
        </View>
      </ScrollView>
    </View>
  );
}
