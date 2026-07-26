import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Text, TouchableOpacity, View, type DimensionValue } from 'react-native';
import ClusteredMapView from 'react-native-map-clustering';
import { Marker, PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import { useLocation } from '../../app/hooks/useLocation';
import { searchBountiesNearby, type NearbyBounty } from '../../lib/services/bounty-location-service';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';

// Continental US centroid — starting viewport only, when we have neither the
// bounty poster's approx point nor the viewer's device location yet.
const FALLBACK_REGION: Region = {
  latitude: 39.8283,
  longitude: -98.5795,
  latitudeDelta: 25,
  longitudeDelta: 25,
};

interface AnimatedPinProps {
  selected: boolean;
}

function AnimatedPin({ selected }: AnimatedPinProps) {
  const { theme } = useAppThemeContext();
  const scale = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 6, tension: 80 }).start();
  }, [scale]);

  return (
    <Animated.View
      style={{
        transform: [{ scale: selected ? scale.interpolate({ inputRange: [0, 1], outputRange: [0, 1.25] }) : scale }],
        width: 22, height: 22, borderRadius: 11,
        backgroundColor: theme.primary, borderWidth: 3, borderColor: '#fff',
        shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 3, shadowOffset: { width: 0, height: 1 },
      }}
    />
  );
}

interface BountyMapViewProps {
  category?: string | null;
  height?: DimensionValue;
}

export function BountyMapView({ category, height = '100%' }: BountyMapViewProps) {
  const { theme } = useAppThemeContext();
  const router = useRouter();
  const { location: userLocation } = useLocation();
  const [bounties, setBounties] = useState<NearbyBounty[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const results = await searchBountiesNearby({
        latitude: userLocation?.latitude,
        longitude: userLocation?.longitude,
        radiusMiles: null, // Anywhere — the map itself is the filter (pan/zoom)
        category: category ?? null,
        limit: 100,
      });
      setBounties(results.filter((b) => b.approx_latitude != null && b.approx_longitude != null));
    } finally {
      setIsLoading(false);
    }
  }, [userLocation?.latitude, userLocation?.longitude, category]);

  useEffect(() => {
    load();
  }, [load]);

  const initialRegion: Region = useMemo(() => {
    if (userLocation) {
      return { latitude: userLocation.latitude, longitude: userLocation.longitude, latitudeDelta: 0.3, longitudeDelta: 0.3 };
    }
    return FALLBACK_REGION;
  }, [userLocation]);

  const selected = bounties.find((b) => b.id === selectedId) || null;

  return (
    <View style={{ height, width: '100%' }}>
      <ClusteredMapView
        // @ts-ignore — react-native-map-clustering's types lag react-native-maps'
        provider={PROVIDER_GOOGLE}
        style={{ flex: 1 }}
        initialRegion={initialRegion}
        showsTraffic
        showsUserLocation
        showsMyLocationButton
        onPress={() => setSelectedId(null)}
        radius={50}
        extent={512}
        nodeSize={64}
      >
        {bounties.map((bounty) => (
          <Marker
            key={bounty.id}
            coordinate={{ latitude: bounty.approx_latitude!, longitude: bounty.approx_longitude! }}
            onPress={() => setSelectedId(bounty.id)}
            tracksViewChanges={false}
          >
            <AnimatedPin selected={selectedId === bounty.id} />
          </Marker>
        ))}
      </ClusteredMapView>

      {isLoading && (
        <View style={{ position: 'absolute', top: 12, alignSelf: 'center', backgroundColor: theme.surface, borderRadius: 999, padding: 8 }}>
          <ActivityIndicator size="small" color={theme.primary} />
        </View>
      )}

      {selected && (
        <TouchableOpacity
          onPress={() => router.push(`/bounty/${selected.id}` as any)}
          style={{
            position: 'absolute', left: 12, right: 12, bottom: 12,
            backgroundColor: theme.surface, borderRadius: 14, padding: 14,
            borderWidth: 1, borderColor: theme.border,
            shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
          }}
          accessibilityRole="button"
          accessibilityLabel={`Open bounty ${selected.title}`}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ color: theme.text, fontWeight: '700', fontSize: 15, flex: 1, marginRight: 8 }} numberOfLines={1}>
              {selected.title}
            </Text>
            <Text style={{ color: theme.primary, fontWeight: '800', fontSize: 15 }}>
              {selected.is_for_honor ? 'Honor' : `$${Number(selected.amount).toFixed(0)}`}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
            <MaterialIcons name="place" size={13} color={theme.textSecondary} />
            <Text style={{ color: theme.textSecondary, fontSize: 12, marginLeft: 3 }}>
              {selected.neighborhood || 'Nearby'}
              {selected.distance_miles != null ? ` · ${selected.distance_miles.toFixed(1)} mi` : ''}
            </Text>
          </View>
        </TouchableOpacity>
      )}
    </View>
  );
}

export default BountyMapView;
