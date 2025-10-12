import { MaterialIcons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export interface FilterOptions {
  distanceMax: number; // in miles
  amountMin: number;
  amountMax: number;
  sortBy: 'newest' | 'highest_pay' | 'nearest' | 'default';
  workType: 'all' | 'online' | 'in_person';
}

interface FilterBarProps {
  filters: FilterOptions;
  onFiltersChange: (filters: FilterOptions) => void;
  onToggleMapView?: () => void;
  isMapView?: boolean;
}

export function FilterBar({ filters, onFiltersChange, onToggleMapView, isMapView }: FilterBarProps) {
  const [showModal, setShowModal] = useState(false);
  const [localFilters, setLocalFilters] = useState<FilterOptions>(filters);

  const distanceOptions = [5, 10, 25, 50, 100, 999]; // 999 = "Any"
  const amountRanges = [
    { min: 0, max: 25, label: '$0-$25' },
    { min: 25, max: 50, label: '$25-$50' },
    { min: 50, max: 100, label: '$50-$100' },
    { min: 100, max: 500, label: '$100-$500' },
    { min: 500, max: 999999, label: '$500+' },
    { min: 0, max: 999999, label: 'Any' },
  ];

  const sortOptions: Array<{ value: FilterOptions['sortBy']; label: string; icon: string }> = [
    { value: 'default', label: 'Relevance', icon: 'auto-awesome' },
    { value: 'newest', label: 'Newest', icon: 'schedule' },
    { value: 'highest_pay', label: 'Highest Pay', icon: 'payments' },
    { value: 'nearest', label: 'Nearest', icon: 'near-me' },
  ];

  const workTypeOptions: Array<{ value: FilterOptions['workType']; label: string }> = [
    { value: 'all', label: 'All' },
    { value: 'online', label: 'Online' },
    { value: 'in_person', label: 'In Person' },
  ];

  const handleApply = () => {
    onFiltersChange(localFilters);
    setShowModal(false);
  };

  const handleReset = () => {
    const defaultFilters: FilterOptions = {
      distanceMax: 999,
      amountMin: 0,
      amountMax: 999999,
      sortBy: 'default',
      workType: 'all',
    };
    setLocalFilters(defaultFilters);
    onFiltersChange(defaultFilters);
    setShowModal(false);
  };

  const hasActiveFilters = 
    filters.distanceMax !== 999 || 
    filters.amountMin !== 0 || 
    filters.amountMax !== 999999 ||
    filters.workType !== 'all';

  return (
    <>
      <View style={styles.container}>
        {/* Filter Button */}
        <TouchableOpacity 
          style={[styles.button, hasActiveFilters && styles.buttonActive]}
          onPress={() => setShowModal(true)}
        >
          <MaterialIcons 
            name="filter-list" 
            size={18} 
            color={hasActiveFilters ? '#052e1b' : '#d1fae5'} 
          />
          <Text style={[styles.buttonText, hasActiveFilters && styles.buttonTextActive]}>
            Filters
          </Text>
          {hasActiveFilters && <View style={styles.activeDot} />}
        </TouchableOpacity>

        {/* Sort Button */}
        <TouchableOpacity 
          style={[styles.button, filters.sortBy !== 'default' && styles.buttonActive]}
          onPress={() => setShowModal(true)}
        >
          <MaterialIcons 
            name={sortOptions.find(o => o.value === filters.sortBy)?.icon as any || 'sort'} 
            size={18} 
            color={filters.sortBy !== 'default' ? '#052e1b' : '#d1fae5'} 
          />
          <Text style={[styles.buttonText, filters.sortBy !== 'default' && styles.buttonTextActive]}>
            {sortOptions.find(o => o.value === filters.sortBy)?.label || 'Sort'}
          </Text>
        </TouchableOpacity>

        {/* Map View Toggle (Optional) */}
        {onToggleMapView && (
          <TouchableOpacity 
            style={[styles.button, isMapView && styles.buttonActive]}
            onPress={onToggleMapView}
          >
            <MaterialIcons 
              name={isMapView ? 'list' : 'map'} 
              size={18} 
              color={isMapView ? '#052e1b' : '#d1fae5'} 
            />
            <Text style={[styles.buttonText, isMapView && styles.buttonTextActive]}>
              {isMapView ? 'List' : 'Map'}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Filter Modal */}
      <Modal
        visible={showModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {/* Header */}
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Filters & Sorting</Text>
              <TouchableOpacity onPress={() => setShowModal(false)}>
                <MaterialIcons name="close" size={24} color="#ffffff" />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
              {/* Sort By Section */}
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Sort By</Text>
                <View style={styles.optionsGrid}>
                  {sortOptions.map((option) => (
                    <TouchableOpacity
                      key={option.value}
                      style={[
                        styles.optionChip,
                        localFilters.sortBy === option.value && styles.optionChipActive,
                      ]}
                      onPress={() => setLocalFilters({ ...localFilters, sortBy: option.value })}
                    >
                      <MaterialIcons
                        name={option.icon as any}
                        size={16}
                        color={localFilters.sortBy === option.value ? '#052e1b' : '#d1fae5'}
                        style={{ marginRight: 6 }}
                      />
                      <Text
                        style={[
                          styles.optionChipText,
                          localFilters.sortBy === option.value && styles.optionChipTextActive,
                        ]}
                      >
                        {option.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Distance Section */}
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Max Distance</Text>
                <View style={styles.optionsGrid}>
                  {distanceOptions.map((distance) => (
                    <TouchableOpacity
                      key={distance}
                      style={[
                        styles.optionChip,
                        localFilters.distanceMax === distance && styles.optionChipActive,
                      ]}
                      onPress={() => setLocalFilters({ ...localFilters, distanceMax: distance })}
                    >
                      <Text
                        style={[
                          styles.optionChipText,
                          localFilters.distanceMax === distance && styles.optionChipTextActive,
                        ]}
                      >
                        {distance === 999 ? 'Any' : `${distance} mi`}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Amount Range Section */}
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Amount Range</Text>
                <View style={styles.optionsGrid}>
                  {amountRanges.map((range) => {
                    const isActive =
                      localFilters.amountMin === range.min && localFilters.amountMax === range.max;
                    return (
                      <TouchableOpacity
                        key={range.label}
                        style={[styles.optionChip, isActive && styles.optionChipActive]}
                        onPress={() =>
                          setLocalFilters({
                            ...localFilters,
                            amountMin: range.min,
                            amountMax: range.max,
                          })
                        }
                      >
                        <Text
                          style={[
                            styles.optionChipText,
                            isActive && styles.optionChipTextActive,
                          ]}
                        >
                          {range.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {/* Work Type Section */}
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Work Type</Text>
                <View style={styles.optionsGrid}>
                  {workTypeOptions.map((option) => (
                    <TouchableOpacity
                      key={option.value}
                      style={[
                        styles.optionChip,
                        localFilters.workType === option.value && styles.optionChipActive,
                      ]}
                      onPress={() => setLocalFilters({ ...localFilters, workType: option.value })}
                    >
                      <Text
                        style={[
                          styles.optionChipText,
                          localFilters.workType === option.value && styles.optionChipTextActive,
                        ]}
                      >
                        {option.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </ScrollView>

            {/* Footer Actions */}
            <View style={styles.modalFooter}>
              <TouchableOpacity style={styles.resetButton} onPress={handleReset}>
                <Text style={styles.resetButtonText}>Reset</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.applyButton} onPress={handleApply}>
                <Text style={styles.applyButtonText}>Apply Filters</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
    gap: 6,
  },
  buttonActive: {
    backgroundColor: '#6ee7b7',
    borderColor: '#6ee7b7',
  },
  buttonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#d1fae5',
  },
  buttonTextActive: {
    color: '#052e1b',
  },
  activeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#052e1b',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#047857',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 20,
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(16, 185, 129, 0.2)',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  modalScroll: {
    paddingHorizontal: 20,
    paddingVertical: 20,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#d1fae5',
    marginBottom: 12,
  },
  optionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  optionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  optionChipActive: {
    backgroundColor: '#6ee7b7',
    borderColor: '#6ee7b7',
  },
  optionChipText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#d1fae5',
  },
  optionChipTextActive: {
    color: '#052e1b',
    fontWeight: '600',
  },
  modalFooter: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 16,
    paddingBottom: 32,
    borderTopWidth: 1,
    borderTopColor: 'rgba(16, 185, 129, 0.2)',
  },
  resetButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
    alignItems: 'center',
  },
  resetButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#d1fae5',
  },
  applyButton: {
    flex: 2,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#6ee7b7',
    alignItems: 'center',
  },
  applyButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#052e1b',
  },
});
