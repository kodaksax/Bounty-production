import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthContext } from '../../hooks/use-auth-context';
import { searchService } from '../../lib/services/search-service';
import type { SavedSearch } from '../../lib/types';

export default function SavedSearchesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuthContext();
  const userId = session?.user?.id;

  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showNewSearchModal, setShowNewSearchModal] = useState(false);
  const [newSearchName, setNewSearchName] = useState('');
  const [newSearchQuery, setNewSearchQuery] = useState('');

  const loadSavedSearches = useCallback(async () => {
    if (!userId) {
      setIsLoading(false);
      return;
    }
    
    try {
      const searches = await searchService.getSavedSearches(userId);
      setSavedSearches(searches);
    } catch (error) {
      console.error('Failed to load saved searches:', error);
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    loadSavedSearches();
  }, [loadSavedSearches]);

  const handleCreateSearch = async () => {
    if (!userId || !newSearchName.trim()) {
      Alert.alert('Error', 'Please enter a name for your saved search');
      return;
    }

    try {
      await searchService.saveSearch(
        userId,
        newSearchName.trim(),
        'bounty',
        newSearchQuery.trim(),
        undefined,
        true
      );
      setNewSearchName('');
      setNewSearchQuery('');
      setShowNewSearchModal(false);
      await loadSavedSearches();
    } catch (error) {
      Alert.alert('Error', 'Failed to save search');
    }
  };

  const handleDeleteSearch = async (searchId: string) => {
    if (!userId) return;

    Alert.alert(
      'Delete Saved Search',
      'Are you sure you want to delete this saved search?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await searchService.deleteSavedSearch(userId, searchId);
            await loadSavedSearches();
          },
        },
      ]
    );
  };

  const handleToggleAlerts = async (searchId: string, currentState: boolean) => {
    if (!userId) return;
    
    await searchService.toggleSearchAlerts(userId, searchId, !currentState);
    await loadSavedSearches();
  };

  const handleRunSearch = (search: SavedSearch) => {
    router.push({
      pathname: '/tabs/search',
      params: { q: search.query },
    });
  };

  const renderSavedSearch = ({ item }: { item: SavedSearch }) => (
    <View style={styles.searchCard}>
      <TouchableOpacity
        style={styles.searchContent}
        onPress={() => handleRunSearch(item)}
        accessibilityRole="button"
        accessibilityLabel={`Saved search: ${item.name}${item.query ? ', query: ' + item.query : ''}, created ${new Date(item.createdAt).toLocaleDateString()}`}
        accessibilityHint="Tap to run this saved search"
      >
        <View style={styles.searchHeader}>
          <MaterialIcons name="bookmark" size={20} color="#6ee7b7" />
          <Text style={styles.searchName}>{item.name}</Text>
        </View>
        {item.query && (
          <Text style={styles.searchQuery} numberOfLines={1}>
            {"\""}
            {item.query}
            {"\""}
          </Text>
        )}
        <Text style={styles.searchDate}>
          Created {new Date(item.createdAt).toLocaleDateString()}
        </Text>
      </TouchableOpacity>
      
      <View style={styles.searchActions}>
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => handleToggleAlerts(item.id, item.alertsEnabled)}
          accessibilityRole="button"
          accessibilityLabel={item.alertsEnabled ? 'Alerts enabled' : 'Alerts disabled'}
          accessibilityHint={item.alertsEnabled ? 'Tap to disable alerts for this search' : 'Tap to enable alerts for this search'}
        >
          <MaterialIcons
            name={item.alertsEnabled ? 'notifications-active' : 'notifications-off'}
            size={20}
            color={item.alertsEnabled ? '#fcd34d' : '#6b7280'}
          />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => handleDeleteSearch(item.id)}
          accessibilityRole="button"
          accessibilityLabel="Delete saved search"
          accessibilityHint="Tap to delete this saved search"
        >
          <MaterialIcons name="delete-outline" size={20} color="#f87171" />
        </TouchableOpacity>
      </View>
    </View>
  );

  if (!userId) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <MaterialIcons name="arrow-back" size={22} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Saved Searches</Text>
        </View>
        <View style={styles.emptyContainer}>
          <MaterialIcons name="lock-outline" size={48} color="#6b7280" />
          <Text style={styles.emptyText}>Sign in to save searches</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <MaterialIcons name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Saved Searches</Text>
        <TouchableOpacity
          onPress={() => setShowNewSearchModal(true)}
          style={styles.addBtn}
        >
          <MaterialIcons name="add" size={24} color="#6ee7b7" />
        </TouchableOpacity>
      </View>

      <Text style={styles.subtitle}>
        Save your searches and get notified when new bounties match.
      </Text>

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color="#6ee7b7" size="large" />
        </View>
      ) : savedSearches.length === 0 ? (
        <View style={styles.emptyContainer}>
          <MaterialIcons name="bookmark-outline" size={48} color="#6b7280" />
          <Text style={styles.emptyText}>No saved searches yet</Text>
          <TouchableOpacity
            style={styles.createBtn}
            onPress={() => setShowNewSearchModal(true)}
          >
            <Text style={styles.createBtnText}>Create your first saved search</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={savedSearches}
          keyExtractor={(item) => item.id}
          renderItem={renderSavedSearch}
          contentContainerStyle={styles.listContent}
        />
      )}

      {/* New Search Modal */}
      {showNewSearchModal && (
        <View style={[styles.modalOverlay, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>New Saved Search</Text>
              <TouchableOpacity onPress={() => setShowNewSearchModal(false)}>
                <MaterialIcons name="close" size={24} color="#fff" />
              </TouchableOpacity>
            </View>

            <View style={styles.modalBody}>
              <Text style={styles.inputLabel}>Search Name</Text>
              <TextInput
                style={styles.textInput}
                placeholder="e.g., Remote React Jobs"
                placeholderTextColor="#6b7280"
                value={newSearchName}
                onChangeText={setNewSearchName}
              />

              <Text style={styles.inputLabel}>Search Keywords (optional)</Text>
              <TextInput
                style={styles.textInput}
                placeholder="e.g., react, typescript"
                placeholderTextColor="#6b7280"
                value={newSearchQuery}
                onChangeText={setNewSearchQuery}
              />

              <Text style={styles.hintText}>
                You
                {"'"}
                ll receive notifications when new bounties match this search.
              </Text>
            </View>

            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setShowNewSearchModal(false)}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.saveBtn, !newSearchName.trim() && styles.saveBtnDisabled]}
                onPress={handleCreateSearch}
                disabled={!newSearchName.trim()}
              >
                <Text style={[styles.saveBtnText, !newSearchName.trim() && styles.saveBtnTextDisabled]}>Save Search</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
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
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  backBtn: {
    padding: 8,
    marginRight: 4,
  },
  headerTitle: {
    flex: 1,
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    marginLeft: 4,
  },
  addBtn: {
    padding: 8,
  },
  subtitle: {
    color: '#d1fae5',
    fontSize: 13,
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  emptyText: {
    color: '#a7f3d0',
    fontSize: 16,
    marginTop: 12,
    textAlign: 'center',
  },
  createBtn: {
    marginTop: 16,
    backgroundColor: '#047857',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
  },
  createBtnText: {
    color: '#6ee7b7',
    fontSize: 14,
    fontWeight: '600',
  },
  listContent: {
    paddingHorizontal: 12,
    paddingBottom: 100,
  },
  searchCard: {
    backgroundColor: 'rgba(0,0,0,0.15)',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  searchContent: {
    flex: 1,
  },
  searchHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  searchName: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  searchQuery: {
    color: '#a7f3d0',
    fontSize: 13,
    marginBottom: 4,
  },
  searchDate: {
    color: '#6b7280',
    fontSize: 11,
  },
  searchActions: {
    flexDirection: 'row',
    gap: 4,
  },
  actionBtn: {
    padding: 8,
  },
  // Modal styles
  modalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#047857',
    borderRadius: 16,
    width: '90%',
    maxWidth: 400,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  modalTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  modalBody: {
    padding: 16,
  },
  inputLabel: {
    color: '#d1fae5',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
  },
  textInput: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#fff',
    fontSize: 15,
    marginBottom: 16,
  },
  hintText: {
    color: '#6b7280',
    fontSize: 12,
    fontStyle: 'italic',
  },
  modalFooter: {
    flexDirection: 'row',
    padding: 16,
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 8,
  },
  cancelBtnText: {
    color: '#ecfdf5',
    fontSize: 14,
    fontWeight: '600',
  },
  saveBtn: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: '#6ee7b7',
    borderRadius: 8,
  },
  saveBtnText: {
    color: '#065f46',
    fontSize: 14,
    fontWeight: '700',
  },
  saveBtnDisabled: {
    backgroundColor: 'rgba(110,231,183,0.4)',
  },
  saveBtnTextDisabled: {
    color: 'rgba(6,95,70,0.5)',
  },
});
