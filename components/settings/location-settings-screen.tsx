import { MaterialIcons } from '@expo/vector-icons';
import { ThemedButton } from 'components/themed/ThemedButton';
import { ThemedInput } from 'components/themed/ThemedInput';
import { SettingsRow } from 'components/ui/settings-row';
import { SettingsScreenHeader } from 'components/ui/settings-screen-header';
import { SettingsSection } from 'components/ui/settings-section';
import { useAppThemeContext } from 'lib/themes/AppThemeContext';
import type { AppTheme } from 'lib/themes/types';
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAddressLibrary } from '../../app/hooks/useAddressLibrary';
import { useLocation } from '../../app/hooks/useLocation';
import type { SavedAddress } from '../../lib/types';

interface LocationSettingsScreenProps {
  onBack?: () => void;
}

export function LocationSettingsScreen({ onBack }: LocationSettingsScreenProps) {
  const { theme } = useAppThemeContext();
  const insets = useSafeAreaInsets();
  const s = useMemo(() => makeStyles(theme), [theme]);

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

  const grantLabel = permission?.canAskAgain
    ? 'Grant Permission'
    : 'Permission denied - Enable in Settings';

  return (
    <View style={s.screen}>
      <SettingsScreenHeader icon="place" title="Location & Visibility" onBack={onBack} />

      <ScrollView
        contentContainerStyle={[
          s.scrollContent,
          { paddingBottom: Math.max(insets.bottom, 24) + 24 },
        ]}
      >
        <Text style={s.intro}>Manage your location settings and saved addresses</Text>

        <SettingsSection title="Location Permissions">
          <View style={s.permissionBlock}>
            {locationError && (
              <View style={s.errorBanner}>
                <Text style={s.errorBannerText}>{locationError}</Text>
              </View>
            )}

            {permission ? (
              <>
                <View style={s.statusRow}>
                  <MaterialIcons
                    name={permission.granted ? 'check-circle' : 'cancel'}
                    size={20}
                    color={permission.granted ? theme.success : theme.error}
                  />
                  <Text style={s.statusLabel}>
                    Status:{' '}
                    <Text style={[s.statusValue, { color: permission.granted ? theme.success : theme.error }]}>
                      {permission.granted ? 'Granted' : 'Denied'}
                    </Text>
                  </Text>
                </View>

                {location && (
                  <Text style={s.coordsText}>
                    Current location: {location.latitude.toFixed(4)}, {location.longitude.toFixed(4)}
                  </Text>
                )}

                {!permission.granted && (
                  <ThemedButton
                    variant="primary"
                    label={grantLabel}
                    loading={locationLoading}
                    onPress={handleRequestPermission}
                    style={s.grantButton}
                    accessibilityLabel="Request location permission"
                  />
                )}
              </>
            ) : (
              <ActivityIndicator color={theme.primary} />
            )}

            <Text style={s.permissionFootnote}>
              Location is used to calculate distances to in-person bounties and help you find
              opportunities nearby.
            </Text>
          </View>
        </SettingsSection>

        <SettingsSection
          title="Saved Addresses"
          headerRight={
            !showAddForm ? (
              <TouchableOpacity
                onPress={() => setShowAddForm(true)}
                style={s.addChip}
                accessibilityLabel="Add new address"
                accessibilityRole="button"
              >
                <MaterialIcons name="add" size={18} color="#ffffff" />
                <Text style={s.addChipText}>Add</Text>
              </TouchableOpacity>
            ) : undefined
          }
        >
          {addressesError && (
            <View style={s.errorBannerInline}>
              <Text style={s.errorBannerText}>{addressesError}</Text>
            </View>
          )}

          {showAddForm && (
            <View style={s.formBlock}>
              <Text style={s.formTitle}>{editingAddress ? 'Edit Address' : 'Add New Address'}</Text>

              <Text style={s.fieldLabel}>Label</Text>
              <ThemedInput
                value={formLabel}
                onChangeText={setFormLabel}
                placeholder="e.g., Home, Office, Studio"
                accessibilityLabel="Address label"
                containerStyle={s.fieldSpacing}
              />

              <Text style={s.fieldLabel}>Address</Text>
              <ThemedInput
                value={formAddress}
                onChangeText={setFormAddress}
                placeholder="Full address (e.g., 123 Main St, City, State)"
                multiline
                numberOfLines={2}
                textAlignVertical="top"
                accessibilityLabel="Full address"
                containerStyle={s.fieldSpacing}
              />

              <View style={s.formActions}>
                <ThemedButton
                  variant="secondary"
                  label="Cancel"
                  onPress={handleCancelForm}
                  style={s.formActionButton}
                  accessibilityLabel="Cancel"
                />
                <ThemedButton
                  variant="primary"
                  label={editingAddress ? 'Update' : 'Save'}
                  onPress={handleAddressSubmit}
                  style={s.formActionButton}
                  accessibilityLabel={editingAddress ? 'Update address' : 'Save address'}
                />
              </View>
            </View>
          )}

          {addressesLoading ? (
            <View style={s.addressesLoading}>
              <ActivityIndicator size="large" color={theme.primary} />
            </View>
          ) : addresses.length === 0 ? (
            <View style={s.emptyState}>
              <View style={s.emptyIconBadge}>
                <MaterialIcons name="place" size={32} color={theme.primary} />
              </View>
              <Text style={s.emptyTitle}>No addresses saved yet</Text>
              <Text style={s.emptyDescription}>
                Add addresses to quickly fill in location fields when creating bounties
              </Text>
            </View>
          ) : (
            addresses.map((item) => (
              <SettingsRow
                key={item.id}
                icon="place"
                label={item.label}
                description={
                  item.latitude && item.longitude ? `${item.address} · Coordinates available` : item.address
                }
                right={
                  <View style={s.rowActions}>
                    <TouchableOpacity
                      onPress={() => handleEdit(item)}
                      style={s.rowActionButton}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      accessibilityLabel={`Edit ${item.label}`}
                      accessibilityRole="button"
                    >
                      <MaterialIcons name="edit" size={18} color={theme.textSecondary} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => handleDelete(item)}
                      style={s.rowActionButton}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      accessibilityLabel={`Delete ${item.label}`}
                      accessibilityRole="button"
                    >
                      <MaterialIcons name="delete" size={18} color={theme.error} />
                    </TouchableOpacity>
                  </View>
                }
              />
            ))
          )}
        </SettingsSection>
      </ScrollView>
    </View>
  );
}

function makeStyles(t: AppTheme) {
  const errorTint = t.isDark ? 'rgba(239,68,68,0.14)' : 'rgba(239,68,68,0.08)';
  const errorBorder = t.isDark ? 'rgba(239,68,68,0.4)' : 'rgba(239,68,68,0.3)';
  const primaryTint = t.isDark ? 'rgba(5,150,105,0.16)' : 'rgba(5,150,105,0.1)';
  const primaryBorder = t.isDark ? 'rgba(5,150,105,0.35)' : 'rgba(5,150,105,0.25)';

  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: t.background,
    },
    scrollContent: {
      paddingHorizontal: 16,
      paddingTop: 20,
    },
    intro: {
      fontSize: 14,
      color: t.textSecondary,
      marginBottom: 20,
    },
    permissionBlock: {
      padding: 16,
    },
    errorBanner: {
      backgroundColor: errorTint,
      borderWidth: 1,
      borderColor: errorBorder,
      borderRadius: 10,
      padding: 12,
      marginBottom: 12,
    },
    errorBannerInline: {
      backgroundColor: errorTint,
      borderWidth: 1,
      borderColor: errorBorder,
      borderRadius: 10,
      padding: 12,
      margin: 12,
      marginBottom: 0,
    },
    errorBannerText: {
      color: t.error,
      fontSize: 13,
    },
    statusRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 8,
    },
    statusLabel: {
      color: t.textSecondary,
      marginLeft: 8,
      fontSize: 14,
    },
    statusValue: {
      fontWeight: '700',
    },
    coordsText: {
      color: t.textSecondary,
      fontSize: 13,
      marginBottom: 12,
    },
    grantButton: {
      marginTop: 4,
      marginBottom: 4,
    },
    permissionFootnote: {
      color: t.textDisabled,
      fontSize: 12,
      lineHeight: 16,
      marginTop: 12,
    },
    addChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: t.primary,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 8,
      minHeight: 32,
    },
    addChipText: {
      color: '#ffffff',
      fontWeight: '600',
      fontSize: 13,
    },
    formBlock: {
      padding: 16,
    },
    formTitle: {
      color: t.text,
      fontSize: 16,
      fontWeight: '700',
      marginBottom: 12,
    },
    fieldLabel: {
      color: t.textSecondary,
      fontSize: 13,
      marginBottom: 6,
    },
    fieldSpacing: {
      marginBottom: 14,
    },
    formActions: {
      flexDirection: 'row',
      gap: 10,
    },
    formActionButton: {
      flex: 1,
    },
    addressesLoading: {
      paddingVertical: 32,
      alignItems: 'center',
    },
    emptyState: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 40,
      paddingHorizontal: 32,
    },
    emptyIconBadge: {
      width: 72,
      height: 72,
      borderRadius: 36,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: primaryTint,
      borderWidth: 1,
      borderColor: primaryBorder,
      marginBottom: 16,
    },
    emptyTitle: {
      color: t.text,
      fontSize: 16,
      fontWeight: '700',
      marginBottom: 6,
      textAlign: 'center',
    },
    emptyDescription: {
      color: t.textSecondary,
      fontSize: 13,
      lineHeight: 18,
      textAlign: 'center',
      maxWidth: 260,
    },
    rowActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    rowActionButton: {
      width: 32,
      height: 32,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.surfaceSecondary,
    },
  });
}
