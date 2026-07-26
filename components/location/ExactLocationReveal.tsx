import { MaterialIcons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { getBountyExactLocation, type ExactBountyLocation } from '../../lib/services/bounty-location-service';
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
  const [location, setLocation] = useState<ExactBountyLocation | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!canReveal || !bountyId) return;
    let cancelled = false;
    setIsLoading(true);
    getBountyExactLocation(bountyId).then((result) => {
      if (!cancelled) {
        setLocation(result);
        setIsLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [bountyId, canReveal]);

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

  return (
    <View>
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
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginTop: 8 }}>
        <MaterialIcons name="verified" size={16} color={theme.primary} style={{ marginRight: 6, marginTop: 2 }} />
        <Text style={{ flex: 1, color: theme.text, fontSize: 13 }}>
          {location.location}
          {location.unit ? `, ${location.unit}` : ''}
        </Text>
      </View>
    </View>
  );
}

export default ExactLocationReveal;
