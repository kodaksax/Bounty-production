import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { formatExactAddress, useBountyExactLocation } from '../../hooks/useBountyExactLocation';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';

interface ExactLocationRevealProps {
  bountyId: string;
  /** Caller-known gate (poster or accepted hunter) — avoids an RPC round-trip when we already know it'll be denied. */
  canReveal: boolean;
  height?: number;
}

/**
 * Post-acceptance exact-location display. Only fetches
 * get_bounty_exact_location() when `canReveal` is true (the caller already
 * knows the current user is the poster or the accepted hunter) — the RPC
 * itself independently re-checks auth.uid() server-side regardless, so this
 * is a UX optimization, not the actual security boundary.
 */
export function ExactLocationReveal({ bountyId, canReveal, height = 160 }: ExactLocationRevealProps) {
  const { theme } = useAppThemeContext();
  const { exact: location, isLoading } = useBountyExactLocation(bountyId, canReveal);

  if (!canReveal) {
    return null;
  }

  if (isLoading) {
    return (
      <View style={{ height, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="small" color={theme.primary} />
      </View>
    );
  }

  if (!location) {
    return (
      <View
        style={{
          padding: 12, borderRadius: 12, borderWidth: 1, borderColor: theme.border,
          backgroundColor: theme.surfaceSecondary,
        }}
      >
        <Text style={{ color: theme.textSecondary, fontSize: 12 }}>
          Exact location isn&apos;t available yet.
        </Text>
      </View>
    );
  }

  const address = formatExactAddress(location);

  return (
    <View>
      {location.latitude != null && location.longitude != null && (
        <View style={{ height, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: theme.border }}>
          <MapView
            provider={PROVIDER_GOOGLE}
            style={{ flex: 1 }}
            initialRegion={{
              latitude: location.latitude,
              longitude: location.longitude,
              latitudeDelta: 0.01,
              longitudeDelta: 0.01,
            }}
          >
            <Marker coordinate={{ latitude: location.latitude, longitude: location.longitude }} />
          </MapView>
        </View>
      )}
      {address && (
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginTop: 8 }}>
          <MaterialIcons name="verified" size={16} color={theme.primary} style={{ marginRight: 6, marginTop: 2 }} />
          <Text style={{ flex: 1, color: theme.text, fontSize: 13 }}>{address}</Text>
        </View>
      )}
    </View>
  );
}

export default ExactLocationReveal;
