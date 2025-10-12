import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { Bounty } from '../lib/services/database.types';

interface BountyMapViewProps {
  bounties: Bounty[];
  onBountyPress?: (bounty: Bounty) => void;
  onClose?: () => void;
}

/**
 * Placeholder MapView component for bounties.
 * 
 * To implement full map functionality:
 * 1. Install: npx expo install react-native-maps
 * 2. For web: Install react-map-gl or use a web-friendly map library
 * 3. Add expo-location for real geolocation
 * 4. Implement clustering for many pins (react-native-map-clustering)
 * 
 * For now, this shows a simple grid/list view as a map placeholder.
 */
export function BountyMapView({ bounties, onBountyPress, onClose }: BountyMapViewProps) {
  const groupByLocation = (bounties: Bounty[]) => {
    const groups: Record<string, Bounty[]> = {};
    bounties.forEach((bounty) => {
      const loc = bounty.location || 'Unknown';
      if (!groups[loc]) {
        groups[loc] = [];
      }
      groups[loc].push(bounty);
    });
    return groups;
  };

  const locationGroups = groupByLocation(bounties);
  const locations = Object.keys(locationGroups);

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <MaterialIcons name="map" size={24} color="#ffffff" />
          <Text style={styles.headerTitle}>Map View</Text>
        </View>
        {onClose && (
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <MaterialIcons name="close" size={24} color="#ffffff" />
          </TouchableOpacity>
        )}
      </View>

      {/* Info Banner */}
      <View style={styles.infoBanner}>
        <MaterialIcons name="info-outline" size={20} color="#6ee7b7" />
        <Text style={styles.infoText}>
          Map view is in beta. Showing grouped bounties by location.
        </Text>
      </View>

      {/* Location Groups (Placeholder for map pins) */}
      <View style={styles.content}>
        {locations.length === 0 ? (
          <View style={styles.emptyState}>
            <MaterialIcons name="location-off" size={64} color="rgba(255, 255, 255, 0.3)" />
            <Text style={styles.emptyTitle}>No bounties with locations</Text>
            <Text style={styles.emptyText}>
              Bounties without location data cannot be shown on the map
            </Text>
          </View>
        ) : (
          <View style={styles.locationsGrid}>
            {locations.map((location) => {
              const bountiesAtLocation = locationGroups[location];
              return (
                <TouchableOpacity
                  key={location}
                  style={styles.locationCard}
                  onPress={() => onBountyPress?.(bountiesAtLocation[0])}
                >
                  <View style={styles.locationHeader}>
                    <MaterialIcons name="place" size={20} color="#6ee7b7" />
                    <Text style={styles.locationName} numberOfLines={1}>
                      {location}
                    </Text>
                  </View>
                  <View style={styles.locationBadge}>
                    <Text style={styles.locationBadgeText}>
                      {bountiesAtLocation.length} {bountiesAtLocation.length === 1 ? 'bounty' : 'bounties'}
                    </Text>
                  </View>
                  <View style={styles.locationBounties}>
                    {bountiesAtLocation.slice(0, 2).map((bounty, idx) => (
                      <Text key={bounty.id} style={styles.bountyTitle} numberOfLines={1}>
                        • {bounty.title}
                      </Text>
                    ))}
                    {bountiesAtLocation.length > 2 && (
                      <Text style={styles.moreText}>
                        +{bountiesAtLocation.length - 2} more
                      </Text>
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </View>

      {/* Implementation Note */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>
          💡 To enable full interactive map: Install react-native-maps and expo-location
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#059669',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(16, 185, 129, 0.3)',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  closeButton: {
    padding: 8,
  },
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'rgba(110, 231, 183, 0.1)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(16, 185, 129, 0.2)',
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    color: '#6ee7b7',
  },
  content: {
    flex: 1,
    padding: 16,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#ffffff',
    marginTop: 16,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.7)',
    textAlign: 'center',
  },
  locationsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  locationCard: {
    width: '48%',
    minWidth: 150,
    backgroundColor: '#047857',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  locationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  locationName: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
  },
  locationBadge: {
    backgroundColor: 'rgba(110, 231, 183, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    alignSelf: 'flex-start',
    marginBottom: 8,
  },
  locationBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#6ee7b7',
  },
  locationBounties: {
    gap: 4,
  },
  bountyTitle: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.8)',
  },
  moreText: {
    fontSize: 11,
    color: '#6ee7b7',
    fontStyle: 'italic',
    marginTop: 2,
  },
  footer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(16, 185, 129, 0.2)',
  },
  footerText: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.6)',
    textAlign: 'center',
  },
});
