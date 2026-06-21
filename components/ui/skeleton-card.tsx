import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Skeleton } from './skeleton';

/**
 * Skeleton card component for bounty cards during loading states.
 * This component provides a consistent loading experience across bounty lists.
 */
export function SkeletonCard() {
  return (
    <View style={styles.card}>
      {/* Header: avatar and poster info */}
      <View style={styles.header}>
        <Skeleton className="h-10 w-10 rounded-full bg-[#111827]" />
        <View style={styles.headerText}>
          <Skeleton className="h-4 w-32 mb-2 bg-[#111827]" />
          <Skeleton className="h-3 w-20 bg-[#111827]" />
        </View>
      </View>
      
      {/* Title */}
      <Skeleton className="h-5 w-full mb-2 bg-[#111827]" />
      
      {/* Description lines */}
      <Skeleton className="h-3 w-full mb-2 bg-[#111827]" />
      <Skeleton className="h-3 w-4/5 mb-3 bg-[#111827]" />
      
      {/* Footer: amount, location, and actions */}
      <View style={styles.footer}>
        <Skeleton className="h-4 w-24 bg-[#111827]" />
        <Skeleton className="h-4 w-28 bg-[#111827]" />
      </View>
      
      {/* Action buttons */}
      <View style={styles.actions}>
        <Skeleton className="h-10 flex-1 rounded-lg mr-2 bg-[#111827]" />
        <Skeleton className="h-10 flex-1 rounded-lg bg-[#111827]" />
      </View>
    </View>
  );
}

/**
 * Multiple skeleton cards for loading lists of bounties
 */
export function SkeletonCardList({ count = 3 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={`skeleton-card-${i}`} />
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(5, 150, 105, 0.2)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#374151',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  headerText: {
    marginLeft: 12,
    flex: 1,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
});
