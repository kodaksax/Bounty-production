import { MaterialIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    Modal,
    ScrollView,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { bountyService } from '../../lib/services/bounty-service';
import type { Bounty } from '../../lib/services/database.types';
import { recentSearchService } from '../../lib/services/recent-search-service';
import { searchService } from '../../lib/services/search-service';
import { userSearchService } from '../../lib/services/user-search-service';
import type { AutocompleteSuggestion, BountySearchFilters, RecentSearch, UserProfile } from '../../lib/types';
import { logger } from '../../lib/utils/error-logger';

type SearchTab = 'bounties' | 'users';

// Debounce delay for autocomplete (500ms as per requirements)
const AUTOCOMPLETE_DEBOUNCE_MS = 500;

interface BountyRowItem {
  id: string;
  title: string;
  description: string;
  amount?: number | null;
  created_at?: string;
  is_for_honor?: boolean;
  location?: string;
  status?: string;
}

export default function EnhancedSearchScreen() {
  const router = useRouter();
  const { q } = useLocalSearchParams<{ q?: string }>();
  const [activeTab, setActiveTab] = useState<SearchTab>('bounties');
  const [query, setQuery] = useState('');
  const [bountyResults, setBountyResults] = useState<BountyRowItem[]>([]);
  const [userResults, setUserResults] = useState<UserProfile[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [recentSearches, setRecentSearches] = useState<RecentSearch[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autocompleteRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const filtersPersistRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // Autocomplete state
  const [suggestions, setSuggestions] = useState<AutocompleteSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [filtersLoaded, setFiltersLoaded] = useState(false);

  // Bounty filters
  const [filters, setFilters] = useState<BountySearchFilters>({
    sortBy: 'date_desc',
    status: ['open'],
  });

  // Handle incoming query parameter from saved searches
  useEffect(() => {
    if (q && q.trim()) {
      setQuery(q);
    }
  }, [q]);

  // Load saved filters on mount
  useEffect(() => {
    const loadSavedFilters = async () => {
      const savedFilters = await searchService.getLastFilters();
      if (savedFilters) {
        setFilters(savedFilters);
      }
      setFiltersLoaded(true);
    };
    loadSavedFilters();
  }, []);

  // Persist filters when they change (debounced to reduce I/O overhead)
  useEffect(() => {
    if (filtersLoaded) {
      if (filtersPersistRef.current) {
        clearTimeout(filtersPersistRef.current);
      }
      filtersPersistRef.current = setTimeout(() => {
        searchService.saveLastFilters(filters);
      }, 500);
    }
    
    return () => {
      if (filtersPersistRef.current) {
        clearTimeout(filtersPersistRef.current);
      }
    };
  }, [filters, filtersLoaded]);

  // Load recent searches function - memoized to be used in dependency arrays
  const loadRecentSearches = useCallback(async () => {
    const searches = await recentSearchService.getRecentSearchesByType(activeTab === 'bounties' ? 'bounty' : 'user');
    setRecentSearches(searches);
  }, [activeTab]);

  // Load recent searches on mount and when activeTab changes
  useEffect(() => {
    loadRecentSearches();
  }, [loadRecentSearches]);
  
  // Autocomplete suggestions with 500ms debounce
  useEffect(() => {
    if (autocompleteRef.current) clearTimeout(autocompleteRef.current);
    
    if (!query.trim()) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    
    setIsLoadingSuggestions(true);
    autocompleteRef.current = setTimeout(async () => {
      try {
        const results = await searchService.getAutocompleteSuggestions(query, 8);
        setSuggestions(results);
        setShowSuggestions(results.length > 0);
      } catch (error) {
        // Log error for debugging but gracefully degrade by hiding suggestions
        logger.warning('Autocomplete suggestions failed', { error });
        setSuggestions([]);
      } finally {
        setIsLoadingSuggestions(false);
      }
    }, AUTOCOMPLETE_DEBOUNCE_MS);
    
    return () => {
      if (autocompleteRef.current) clearTimeout(autocompleteRef.current);
    };
  }, [query]);

  const handleSuggestionPress = useCallback((suggestion: AutocompleteSuggestion) => {
    setShowSuggestions(false);
    
    if (suggestion.type === 'bounty') {
      const bountyId = suggestion.id.replace('bounty_', '');
      router.push(`/postings/${bountyId}`);
    } else if (suggestion.type === 'user') {
      const userId = suggestion.id.replace('user_', '');
      router.push(`/profile/${userId}`);
    } else if (suggestion.type === 'skill') {
      // Search for bounties with this skill, appending to existing skills if not already present
      setQuery(suggestion.text);
      setFilters(prev => ({
        ...prev,
        skills: prev.skills?.includes(suggestion.text)
          ? prev.skills
          : [...(prev.skills || []), suggestion.text]
      }));
    }
  }, [router]);

  const mapBounty = useCallback((b: Bounty): BountyRowItem => ({
    id: b.id.toString(),
    title: b.title || 'Untitled',
    description: b.description || '',
    amount: (b as any).amount,
    created_at: (b as any).created_at,
    is_for_honor: (b as any).is_for_honor,
    location: (b as any).location,
    status: (b as any).status,
  }), []);

  const performBountySearch = useCallback(
    async (searchQuery: string, searchFilters: BountySearchFilters) => {
      setIsSearching(true);
      setError(null);
      try {
        const results = await bountyService.searchWithFilters({
          keywords: searchQuery.trim() || undefined,
          ...searchFilters,
          limit: 50,
        });
        setBountyResults(results.map(mapBounty));
        
        // Save to recent searches if query exists
        if (searchQuery.trim()) {
          await recentSearchService.saveSearch('bounty', searchQuery, searchFilters);
          await loadRecentSearches();
        }
      } catch (e: any) {
        setError(e?.message || 'Search failed');
      } finally {
        setIsSearching(false);
      }
    },
    [mapBounty]
  );

  const performUserSearch = useCallback(async (searchQuery: string) => {
    setIsSearching(true);
    setError(null);
    try {
      const result = await userSearchService.searchUsers({
        keywords: searchQuery.trim() || undefined,
        limit: 50,
      });
      setUserResults(result.results);
      
      // Save to recent searches if query exists
      if (searchQuery.trim()) {
        await recentSearchService.saveSearch('user', searchQuery);
        await loadRecentSearches();
      }
    } catch (e: any) {
      setError(e?.message || 'Search failed');
    } finally {
      setIsSearching(false);
    }
  }, []);

  // Debounce search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    
    debounceRef.current = setTimeout(() => {
      if (activeTab === 'bounties') {
        performBountySearch(query, filters);
      } else {
        performUserSearch(query);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, filters, activeTab, performBountySearch, performUserSearch]);

  const handleRecentSearchClick = useCallback((search: RecentSearch) => {
    setQuery(search.query);
    if (search.filters && activeTab === 'bounties') {
      setFilters(search.filters as BountySearchFilters);
    }
  }, [activeTab]);

  const handleRemoveRecentSearch = useCallback(async (searchId: string) => {
    await recentSearchService.removeSearch(searchId);
    await loadRecentSearches();
  }, [loadRecentSearches]);

  const clearFilters = useCallback(() => {
    setFilters({
      sortBy: 'date_desc',
      status: ['open'],
    });
  }, []);

  const renderBountyItem = useCallback(({ item }: { item: BountyRowItem }) => {
    const priceLabel = item.is_for_honor ? 'for honor' : item.amount != null ? `$${item.amount}` : '';
    const locationLabel = item.location ? `, in ${item.location}` : '';
    const accessibilityLabel = `${item.title}${priceLabel ? ', ' + priceLabel : ''}${locationLabel}`;
    
    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => router.push(`/postings/${item.id}`)}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint="Opens bounty details"
      >
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>{item.title}</Text>
          {item.is_for_honor && (
            <View style={styles.honorBadge}>
              <Text style={styles.honorText}>Honor</Text>
            </View>
          )}
        </View>
        {item.description ? (
          <Text style={styles.cardDesc} numberOfLines={2}>
            {item.description}
          </Text>
        ) : null}
        <View style={styles.metaRow}>
          {item.amount != null && !item.is_for_honor && (
            <Text style={styles.amount}>${item.amount}</Text>
          )}
          {item.location && (
            <Text style={styles.location} numberOfLines={1}>
              📍 {item.location}
            </Text>
          )}
          {item.created_at && (
            <Text style={styles.time}>{timeAgo(item.created_at)}</Text>
          )}
        </View>
        {item.status && item.status !== 'open' && (
          <View style={styles.statusBadge}>
            <Text style={styles.statusText}>{item.status}</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  }, [router]);

  const renderUserItem = useCallback(({ item }: { item: UserProfile }) => {
    const verifiedLabel = item.verificationStatus === 'verified' ? ', verified user' : '';
    const skillsLabel = item.skills && item.skills.length > 0 ? `, skills: ${item.skills.slice(0, 3).join(', ')}` : '';
    const accessibilityLabel = `${item.username}${verifiedLabel}${skillsLabel}`;
    
    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => router.push(`/profile/${item.id}`)}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint="Opens user profile"
      >
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>{item.username}</Text>
          {item.verificationStatus === 'verified' && (
            <MaterialIcons name="verified" size={16} color="#6ee7b7" accessibilityElementsHidden={true} />
          )}
        </View>
        {item.bio && (
          <Text style={styles.cardDesc} numberOfLines={2}>
            {item.bio}
          </Text>
        )}
        {item.skills && item.skills.length > 0 && (
          <View style={styles.skillsRow}>
            {item.skills.slice(0, 3).map((skill, idx) => (
              <View key={`${item.id}-skill-${idx}-${skill.toLowerCase()}`} style={styles.skillChip}>
                <Text style={styles.skillText}>{skill}</Text>
              </View>
            ))}
          </View>
        )}
      </TouchableOpacity>
    );
  }, [router]);

  const renderRecentSearch = useCallback(({ item }: { item: RecentSearch }) => (
    <View style={styles.recentSearchItem}>
      <TouchableOpacity
        style={styles.recentSearchContent}
        onPress={() => handleRecentSearchClick(item)}
        accessibilityRole="button"
        accessibilityLabel={`Recent search: ${item.query}`}
        accessibilityHint="Tap to repeat this search"
      >
        <MaterialIcons name="history" size={18} color="#6ee7b7" accessibilityElementsHidden={true} />
        <Text style={styles.recentSearchText}>{item.query}</Text>
      </TouchableOpacity>
      <TouchableOpacity 
        onPress={() => handleRemoveRecentSearch(item.id)}
        accessibilityRole="button"
        accessibilityLabel="Remove recent search"
        accessibilityHint="Removes this search from history"
      >
        <MaterialIcons name="close" size={18} color="#93e5c7" accessibilityElementsHidden={true} />
      </TouchableOpacity>
    </View>
  ), [handleRecentSearchClick, handleRemoveRecentSearch]);

  const keyExtractorBounty = useCallback((item: BountyRowItem) => item.id, []);
  const keyExtractorUser = useCallback((item: UserProfile) => item.id, []);
  const keyExtractorRecent = useCallback((item: RecentSearch) => item.id, []);

  // NOTE: Search result cards have variable height (title/description lines, optional chips),
  // so getItemLayout with fixed heights would cause incorrect offsets and blank space.
  // Removed getItemLayout to allow FlatList to measure items dynamically.

  const hasActiveFilters = useMemo(() => 
    filters.location ||
    filters.minAmount !== undefined ||
    filters.maxAmount !== undefined ||
    filters.workType ||
    filters.isForHonor !== undefined ||
    (filters.status && filters.status.length > 1),
    [filters]
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity 
          onPress={() => router.back()} 
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          accessibilityHint="Returns to previous screen"
        >
          <MaterialIcons name="arrow-back" size={22} color="#fff" accessibilityElementsHidden={true} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} accessibilityRole="header">Search</Text>
      </View>

      {/* Tab switcher */}
      <View style={styles.tabRow}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'bounties' && styles.tabActive]}
          onPress={() => setActiveTab('bounties')}
          accessibilityRole="tab"
          accessibilityLabel="Search bounties"
          accessibilityState={{ selected: activeTab === 'bounties' }}
          accessibilityHint="Switches to bounty search"
        >
          <Text style={[styles.tabText, activeTab === 'bounties' && styles.tabTextActive]}>
            Bounties
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'users' && styles.tabActive]}
          onPress={() => setActiveTab('users')}
          accessibilityRole="tab"
          accessibilityLabel="Search users"
          accessibilityState={{ selected: activeTab === 'users' }}
          accessibilityHint="Switches to user search"
        >
          <Text style={[styles.tabText, activeTab === 'users' && styles.tabTextActive]}>
            Users
          </Text>
        </TouchableOpacity>
      </View>

      {/* Search bar */}
      <View style={styles.searchRow}>
        <MaterialIcons name="search" size={20} color="#6ee7b7" style={{ marginHorizontal: 8 }} accessibilityElementsHidden={true} />
        <TextInput
          value={query}
          placeholder={activeTab === 'bounties' ? 'Search bounties...' : 'Search users...'}
          placeholderTextColor="#93e5c7"
          onChangeText={(text) => {
            setQuery(text);
            if (!text.trim()) {
              setShowSuggestions(false);
            }
          }}
          onFocus={() => {
            if (suggestions.length > 0) {
              setShowSuggestions(true);
            }
          }}
          returnKeyType="search"
          style={styles.input}
          accessibilityRole="search"
          accessibilityLabel={activeTab === 'bounties' ? 'Search bounties' : 'Search users'}
          accessibilityHint="Type to search with autocomplete suggestions"
        />
        {!!query && !isSearching && (
          <TouchableOpacity 
            onPress={() => { setQuery(''); setShowSuggestions(false); }} 
            style={{ padding: 4 }}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            accessibilityHint="Clears the search text"
          >
            <MaterialIcons name="close" size={18} color="#6ee7b7" accessibilityElementsHidden={true} />
          </TouchableOpacity>
        )}
        {(isSearching || isLoadingSuggestions) && <ActivityIndicator color="#6ee7b7" size="small" style={{ marginRight: 8 }} accessibilityLabel="Loading search results" />}
        {activeTab === 'bounties' && (
          <>
            <TouchableOpacity 
              onPress={() => router.push('/search/saved-searches')} 
              style={styles.filterBtn}
              accessibilityRole="button"
              accessibilityLabel="Saved searches"
              accessibilityHint="View and manage saved searches"
            >
              <MaterialIcons name="bookmark-outline" size={20} color="#6ee7b7" accessibilityElementsHidden={true} />
            </TouchableOpacity>
            <TouchableOpacity 
              onPress={() => setShowFilters(true)} 
              style={styles.filterBtn}
              accessibilityRole="button"
              accessibilityLabel={hasActiveFilters ? "Filter (active)" : "Filter"}
              accessibilityHint="Opens filter options for bounty search"
            >
              <MaterialIcons name="tune" size={20} color={hasActiveFilters ? '#fcd34d' : '#6ee7b7'} accessibilityElementsHidden={true} />
              {hasActiveFilters && <View style={styles.filterDot} />}
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* Autocomplete Suggestions */}
      {showSuggestions && suggestions.length > 0 && (
        <View style={styles.suggestionsContainer}>
          {suggestions.map((suggestion) => (
            <TouchableOpacity
              key={suggestion.id}
              style={styles.suggestionItem}
              onPress={() => handleSuggestionPress(suggestion)}
              accessibilityRole="button"
              accessibilityLabel={`${suggestion.type === 'bounty' ? 'Bounty' : suggestion.type === 'user' ? 'User' : 'Skill'}: ${suggestion.text}${suggestion.subtitle ? ', ' + suggestion.subtitle : ''}`}
              accessibilityHint={suggestion.type === 'bounty' ? 'Opens bounty details' : suggestion.type === 'user' ? 'Opens user profile' : 'Searches for bounties with this skill'}
            >
              <MaterialIcons
                name={suggestion.icon as any || 'search'}
                size={18}
                color="#6ee7b7"
                style={{ marginRight: 10 }}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.suggestionText}>{suggestion.text}</Text>
                {suggestion.subtitle && (
                  <Text style={styles.suggestionSubtext}>{suggestion.subtitle}</Text>
                )}
              </View>
              <View style={styles.suggestionTypeBadge}>
                <Text style={styles.suggestionTypeText}>
                  {suggestion.type === 'bounty' ? 'Bounty' : suggestion.type === 'user' ? 'User' : 'Skill'}
                </Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {error && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>⚠ {error}</Text>
          <TouchableOpacity
            onPress={() => {
              if (activeTab === 'bounties') {
                performBountySearch(query, filters);
              } else {
                performUserSearch(query);
              }
            }}
            style={styles.retryBtn}
          >
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Recent searches */}
      {!query && recentSearches.length > 0 && (
        <View style={styles.recentSection}>
          <View style={styles.recentHeader}>
            <Text style={styles.recentTitle}>Recent Searches</Text>
            <TouchableOpacity onPress={() => recentSearchService.clearAll().then(loadRecentSearches)}>
              <Text style={styles.clearText}>Clear</Text>
            </TouchableOpacity>
          </View>
          <FlatList
            data={recentSearches}
            keyExtractor={keyExtractorRecent}
            renderItem={renderRecentSearch}
            scrollEnabled={false}
            removeClippedSubviews={true}
            maxToRenderPerBatch={10}
            windowSize={3}
            initialNumToRender={5}
          />
        </View>
      )}

      {/* Results */}
      {activeTab === 'bounties' ? (
        <FlatList
          data={bountyResults}
          keyExtractor={keyExtractorBounty}
          renderItem={renderBountyItem}
          contentContainerStyle={{ padding: 12, paddingBottom: 100 }}
          keyboardDismissMode="on-drag"
          ListEmptyComponent={
            query && !isSearching && !error ? (
              <View style={{ padding: 24, alignItems: 'center' }}>
                <Text style={{ color: '#ecfdf5' }}>
                  No bounties found for {"\""}
                  {query}
                  {"\""}
                </Text>
              </View>
            ) : null
          }
          removeClippedSubviews={true}
          maxToRenderPerBatch={10}
          windowSize={5}
          initialNumToRender={8}
        />
      ) : (
        <FlatList
          data={userResults}
          keyExtractor={keyExtractorUser}
          renderItem={renderUserItem}
          contentContainerStyle={{ padding: 12, paddingBottom: 100 }}
          keyboardDismissMode="on-drag"
          ListEmptyComponent={
            query && !isSearching && !error ? (
              <View style={{ padding: 24, alignItems: 'center' }}>
                <Text style={{ color: '#ecfdf5' }}>
                  No users found for {"\""}
                  {query}
                  {"\""}
                </Text>
              </View>
            ) : null
          }
          removeClippedSubviews={true}
          maxToRenderPerBatch={10}
          windowSize={5}
          initialNumToRender={8}
        />
      )}

      {/* Filter Modal */}
      <Modal visible={showFilters} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Filter Bounties</Text>
              <TouchableOpacity onPress={() => setShowFilters(false)}>
                <MaterialIcons name="close" size={24} color="#fff" />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.filterScroll}>
              {/* Sort By */}
              <Text style={styles.filterLabel}>Sort By</Text>
              <View style={styles.filterGroup}>
                {[
                  { value: 'date_desc', label: 'Newest First' },
                  { value: 'date_asc', label: 'Oldest First' },
                  { value: 'amount_desc', label: 'Highest Amount' },
                  { value: 'amount_asc', label: 'Lowest Amount' },
                ].map((option) => (
                  <TouchableOpacity
                    key={option.value}
                    style={[
                      styles.filterOption,
                      filters.sortBy === option.value && styles.filterOptionActive,
                    ]}
                    onPress={() => setFilters({ ...filters, sortBy: option.value as any })}
                  >
                    <Text
                      style={[
                        styles.filterOptionText,
                        filters.sortBy === option.value && styles.filterOptionTextActive,
                      ]}
                    >
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Status */}
              <Text style={styles.filterLabel}>Status</Text>
              <View style={styles.filterGroup}>
                {[
                  { value: 'open', label: 'Open' },
                  { value: 'in_progress', label: 'In Progress' },
                  { value: 'completed', label: 'Completed' },
                ].map((option) => (
                  <TouchableOpacity
                    key={option.value}
                    style={[
                      styles.filterOption,
                      filters.status?.includes(option.value) && styles.filterOptionActive,
                    ]}
                    onPress={() => {
                      const currentStatus = filters.status || ['open'];
                      const newStatus = currentStatus.includes(option.value)
                        ? currentStatus.filter((s) => s !== option.value)
                        : [...currentStatus, option.value];
                      setFilters({ ...filters, status: newStatus });
                    }}
                  >
                    <Text
                      style={[
                        styles.filterOptionText,
                        filters.status?.includes(option.value) && styles.filterOptionTextActive,
                      ]}
                    >
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Work Type */}
              <Text style={styles.filterLabel}>Work Type</Text>
              <View style={styles.filterGroup}>
                {[
                  { value: undefined, label: 'All' },
                  { value: 'online', label: 'Online' },
                  { value: 'in_person', label: 'In Person' },
                ].map((option) => (
                  <TouchableOpacity
                    key={option.label}
                    style={[
                      styles.filterOption,
                      filters.workType === option.value && styles.filterOptionActive,
                    ]}
                    onPress={() => setFilters({ ...filters, workType: option.value as any })}
                  >
                    <Text
                      style={[
                        styles.filterOptionText,
                        filters.workType === option.value && styles.filterOptionTextActive,
                      ]}
                    >
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Amount Range */}
              <Text style={styles.filterLabel}>Amount Range</Text>
              <View style={styles.amountRow}>
                <TextInput
                  style={styles.amountInput}
                  placeholder="Min"
                  placeholderTextColor="#93e5c7"
                  keyboardType="numeric"
                  value={filters.minAmount?.toString() || ''}
                  onChangeText={(text) =>
                    setFilters({ ...filters, minAmount: text ? parseFloat(text) : undefined })
                  }
                />
                <Text style={styles.amountSeparator}>-</Text>
                <TextInput
                  style={styles.amountInput}
                  placeholder="Max"
                  placeholderTextColor="#93e5c7"
                  keyboardType="numeric"
                  value={filters.maxAmount?.toString() || ''}
                  onChangeText={(text) =>
                    setFilters({ ...filters, maxAmount: text ? parseFloat(text) : undefined })
                  }
                />
              </View>
            </ScrollView>

            <View style={styles.modalFooter}>
              <TouchableOpacity style={styles.clearFiltersBtn} onPress={clearFilters}>
                <Text style={styles.clearFiltersBtnText}>Clear All</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.applyFiltersBtn}
                onPress={() => setShowFilters(false)}
              >
                <Text style={styles.applyFiltersBtnText}>Apply Filters</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// Helpers
function timeAgo(ts?: string) {
  if (!ts) return '';
  const date = new Date(ts);
  const diff = Date.now() - date.getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return 'Just now';
  if (hours < 24) return hours + 'h ago';
  const days = Math.floor(hours / 24);
  return days + 'd ago';
}

// Styles
const styles = {
  container: { flex: 1, backgroundColor: '#059669' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 54,
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  backBtn: { padding: 8, marginRight: 4 },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '700', marginLeft: 4 },
  tabRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    marginBottom: 8,
    gap: 8,
  },
  tab: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 8,
  },
  tabActive: { backgroundColor: 'rgba(255,255,255,0.2)' },
  tabText: { color: '#d1fae5', fontSize: 14, fontWeight: '600' },
  tabTextActive: { color: '#fff' },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 24,
    paddingVertical: 6,
    marginBottom: 4,
  },
  input: { flex: 1, color: 'white', paddingVertical: 4, fontSize: 15 },
  filterBtn: { padding: 8, position: 'relative' },
  filterDot: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#fcd34d',
  },
  card: {
    backgroundColor: 'rgba(0,0,0,0.15)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  cardTitle: { color: '#fff', fontSize: 15, fontWeight: '600', flex: 1 },
  cardDesc: { color: '#d1fae5', fontSize: 13, marginBottom: 6 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  amount: { color: '#6ee7b7', fontWeight: '700', fontSize: 13 },
  location: { color: '#a7f3d0', fontSize: 11, flex: 1 },
  time: { color: '#a7f3d0', fontSize: 11 },
  honorBadge: { backgroundColor: '#fcd34d', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 },
  honorText: { color: '#065f46', fontSize: 10, fontWeight: '700' },
  statusBadge: { marginTop: 4, alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 2, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 4 },
  statusText: { color: '#d1fae5', fontSize: 10, textTransform: 'capitalize' },
  skillsRow: { flexDirection: 'row', gap: 6, marginTop: 6, flexWrap: 'wrap' },
  skillChip: { backgroundColor: 'rgba(110,231,183,0.2)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12 },
  skillText: { color: '#6ee7b7', fontSize: 11 },
  recentSection: { paddingHorizontal: 12, paddingVertical: 8 },
  recentHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  recentTitle: { color: '#d1fae5', fontSize: 13, fontWeight: '600' },
  clearText: { color: '#6ee7b7', fontSize: 12 },
  recentSearchItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 },
  recentSearchContent: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  recentSearchText: { color: '#ecfdf5', fontSize: 14 },
  errorBox: { backgroundColor: 'rgba(220,38,38,0.15)', margin: 12, padding: 10, borderRadius: 8 },
  errorText: { color: '#fee2e2', marginBottom: 6, fontSize: 13 },
  retryBtn: {
    backgroundColor: '#065f46',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    alignSelf: 'flex-start',
  },
  retryText: { color: 'white', fontSize: 12, fontWeight: '600' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#047857',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  modalTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  filterScroll: { padding: 16 },
  filterLabel: { color: '#d1fae5', fontSize: 14, fontWeight: '600', marginBottom: 8, marginTop: 12 },
  filterGroup: { gap: 8 },
  filterOption: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  filterOptionActive: { backgroundColor: '#6ee7b7' },
  filterOptionText: { color: '#ecfdf5', fontSize: 14 },
  filterOptionTextActive: { color: '#065f46', fontWeight: '600' },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  amountInput: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
    color: 'white',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    fontSize: 14,
  },
  amountSeparator: { color: '#d1fae5', fontSize: 16 },
  modalFooter: {
    flexDirection: 'row',
    padding: 16,
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  clearFiltersBtn: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 8,
  },
  clearFiltersBtnText: { color: '#ecfdf5', fontSize: 14, fontWeight: '600' },
  applyFiltersBtn: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: '#6ee7b7',
    borderRadius: 8,
  },
  applyFiltersBtnText: { color: '#065f46', fontSize: 14, fontWeight: '700' },
  // Autocomplete styles
  suggestionsContainer: {
    marginHorizontal: 12,
    backgroundColor: 'rgba(0,0,0,0.25)',
    borderRadius: 12,
    marginBottom: 8,
    overflow: 'hidden',
  },
  suggestionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  suggestionText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
  suggestionSubtext: {
    color: '#a7f3d0',
    fontSize: 11,
    marginTop: 2,
  },
  suggestionTypeBadge: {
    backgroundColor: 'rgba(110,231,183,0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  suggestionTypeText: {
    color: '#6ee7b7',
    fontSize: 10,
    fontWeight: '600',
  },
} as const;
