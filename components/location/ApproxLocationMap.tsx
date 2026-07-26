import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import { Text, View } from 'react-native';
import MapView, { Circle, PROVIDER_GOOGLE } from 'react-native-maps';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';

interface ApproxLocationMapProps {
  approxLatitude?: number | null;
  approxLongitude?: number | null;
  neighborhood?: string | null;
  height?: number;
}

/**
 * Read-only, pre-acceptance location display. Shows a shaded ~250m radius
 * circle around the (already jittered server-side) approximate point rather
 * than a precise pin — communicating "this is a general area, not the exact
 * address" the way Airbnb's pre-booking map does. Never fetches or renders
 * the exact address/coordinates; that's ExactLocationReveal's job, gated to
 * the poster/accepted hunter.
 */
export function ApproxLocationMap({ approxLatitude, approxLongitude, neighborhood, height = 140 }: ApproxLocationMapProps) {
  const { theme } = useAppThemeContext();

  if (approxLatitude == null || approxLongitude == null) {
    return (
      <View
        style={{
          height, borderRadius: 12, borderWidth: 1, borderColor: theme.border,
          backgroundColor: theme.surfaceSecondary, alignItems: 'center', justifyContent: 'center',
        }}
      >
        <MaterialIcons name="place" size={20} color={theme.textDisabled} />
        <Text style={{ color: theme.textSecondary, fontSize: 12, marginTop: 4 }}>
          {neighborhood || 'Location shared after acceptance'}
        </Text>
      </View>
    );
  }

  const region = {
    latitude: approxLatitude,
    longitude: approxLongitude,
    latitudeDelta: 0.02,
    longitudeDelta: 0.02,
  };

  return (
    <View style={{ height, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: theme.border }}>
      <MapView
        provider={PROVIDER_GOOGLE}
        style={{ flex: 1 }}
        initialRegion={region}
        scrollEnabled={false}
        zoomEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
        pointerEvents="none"
      >
        <Circle
          center={{ latitude: approxLatitude, longitude: approxLongitude }}
          radius={250}
          strokeColor={theme.primary}
          fillColor={`${theme.primary}33`}
        />
      </MapView>
      {neighborhood && (
        <View
          style={{
            position: 'absolute', bottom: 8, left: 8,
            backgroundColor: theme.surface, borderRadius: 8,
            paddingHorizontal: 8, paddingVertical: 4,
            flexDirection: 'row', alignItems: 'center',
          }}
        >
          <MaterialIcons name="place" size={12} color={theme.primary} />
          <Text style={{ marginLeft: 4, fontSize: 11, fontWeight: '600', color: theme.text }}>{neighborhood}</Text>
        </View>
      )}
    </View>
  );
}

export default ApproxLocationMap;
