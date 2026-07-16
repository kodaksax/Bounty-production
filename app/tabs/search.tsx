import { MaterialIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    Modal,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { SPACING } from '../../lib/constants/accessibility';
import { EmptyState } from '../../components/ui/empty-state';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';
import { bountyService } from '../../lib/services/bounty-service';
import type { Bounty } from '../../lib/services/database.types';
import { recentSearchService } from '../../lib/services/recent-search-service';
import { searchService } from '../../lib/services/search-service';
import { userSearchService } from '../../lib/services/user-search-service';
import type { AutocompleteSuggestion, BountySearchFilters, RecentSearch, UserProfile } from '../../lib/types';
import { logger } from '../../lib/utils/error-logger';
import type { TrendingBounty } from '../../lib/types'
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
  const { theme } = useAppThemeContext();
  const s = useMemo(() => makeStyles(theme), [theme]);
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
  const [trendingBounties, setTrendingBounties] = useState<TrendingBounty[]>([])
  const [isLoadingTrending, setIsLoadingTrending] = useState(true)

  // Autocomplete state
  const [suggestions, setSuggestions] = useState<AutocompleteSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [filtersLoaded, setFiltersLoaded] = useState(false);
  // Load trending bounties
  const loadTrendingBounties = useCallback(async () => {
    setIsLoadingTrending(true)
    try {
      const trending = await searchService.getTrendingBounties(5)
      const unique = Array.from(new Map(trending.map(t => [String(t.id), t])).values())
      setTrendingBounties(unique)
    } catch (error) {
      console.error('Error loading trending bounties:', error)
    } finally {
      setIsLoadingTrending(false)
    }
  }, [])
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
   useEffect(() => {
   
    loadTrendingBounties()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
      router.push(`/bounty/${bountyId}/public`);
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
        style={s.card}
        onPress={() => router.push(`/bounty/${item.id}/public`)}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint="Opens bounty details"
      >
        <View style={s.cardHeader}>
          <Text style={s.cardTitle}>{item.title}</Text>
          {item.is_for_honor && (
            <View style={s.honorBadge}>
              <Text style={s.honorText}>Honor</Text>
            </View>
          )}
        </View>
        {item.description ? (
          <Text style={s.cardDesc} numberOfLines={2}>
            {item.description}
          </Text>
        ) : null}
        <View style={s.metaRow}>
          {item.amount != null && !item.is_for_honor && (
            <Text style={s.amount}>${item.amount}</Text>
          )}
          {item.location && (
            <Text style={s.location} numberOfLines={1}>
              📍 {item.location}
            </Text>
          )}
          {item.created_at && (
            <Text style={s.time}>{timeAgo(item.created_at)}</Text>
          )}
        </View>
        {item.status && item.status !== 'open' && (
          <View style={s.statusBadge}>
            <Text style={s.statusText}>{item.status}</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  }, [router]);

  const renderUserItem = useCallback(({ item }: { item: UserProfile }) => {
    const verifiedLabel = (item.verificationStatus === 'verified' || item.verificationStatus === 'trusted') ? ', verified user' : '';
    const skillsLabel = item.skills && item.skills.length > 0 ? `, skills: ${item.skills.slice(0, 3).join(', ')}` : '';
    const accessibilityLabel = `${item.username}${verifiedLabel}${skillsLabel}`;

    return (
      <TouchableOpacity
        style={s.card}
        onPress={() => router.push(`/profile/${item.id}`)}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint="Opens user profile"
      >
        <View style={s.cardHeader}>
          <Text style={s.cardTitle}>{item.username}</Text>
          {(item.verificationStatus === 'verified' || item.verificationStatus === 'trusted') && (
            <MaterialIcons name="verified" size={16} color={theme.primaryLight} accessibilityElementsHidden={true} />
          )}
        </View>
        {item.bio && (
          <Text style={s.cardDesc} numberOfLines={2}>
            {item.bio}
          </Text>
        )}
        {item.skills && item.skills.length > 0 && (
          <View style={s.skillsRow}>
            {item.skills.slice(0, 3).map((skill, idx) => (
              <View key={`${item.id}-skill-${idx}-${skill.toLowerCase()}`} style={s.skillChip}>
                <Text style={s.skillText}>{skill}</Text>
              </View>
            ))}
          </View>
        )}
      </TouchableOpacity>
    );
  }, [router]);

  const renderRecentSearch = useCallback(({ item }: { item: RecentSearch }) => (
    <View style={s.recentSearchItem}>
      <TouchableOpacity
        style={s.recentSearchContent}
        onPress={() => handleRecentSearchClick(item)}
        accessibilityRole="button"
        accessibilityLabel={`Recent search: ${item.query}`}
        accessibilityHint="Tap to repeat this search"
      >
        <MaterialIcons name="history" size={18} color={theme.primaryLight} accessibilityElementsHidden={true} />
        <Text style={s.recentSearchText}>{item.query}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={() => handleRemoveRecentSearch(item.id)}
        accessibilityRole="button"
        accessibilityLabel="Remove recent search"
        accessibilityHint="Removes this search from history"
      >
        <MaterialIcons name="close" size={18} color={theme.primaryLight} accessibilityElementsHidden={true} />
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
    <View style={s.container}>
      <View style={s.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={s.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          accessibilityHint="Returns to previous screen"
        >
          <MaterialIcons name="arrow-back" size={22} color={theme.text} accessibilityElementsHidden={true} />
        </TouchableOpacity>
        <Text style={s.headerTitle} accessibilityRole="header">Search</Text>
      </View>

     

      {/* Search bar */}
      <View style={s.searchRow}>
        <MaterialIcons name="search" size={20} color={theme.primaryLight} style={s.iconMarginHorizontal8} accessibilityElementsHidden={true} />
        <TextInput
          value={query}
          placeholder={activeTab === 'bounties' ? 'Search bounties...' : 'Search users...'}
          placeholderTextColor="#6B7280"
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
          style={s.input}
          accessibilityRole="search"
          accessibilityLabel={activeTab === 'bounties' ? 'Search bounties' : 'Search users'}
          accessibilityHint="Type to search with autocomplete suggestions"
        />
        {!!query && !isSearching && (
          <TouchableOpacity
              onPress={() => { setQuery(''); setShowSuggestions(false); }}
              style={s.smallPadding}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              accessibilityHint="Clears the search text"
            >
            <MaterialIcons name="close" size={18} color={theme.primaryLight} accessibilityElementsHidden={true} />
          </TouchableOpacity>
        )}
        {(isSearching || isLoadingSuggestions) && <ActivityIndicator color={theme.primaryLight} size="small" style={s.activityMarginRight} accessibilityLabel="Loading search results" />}
        {activeTab === 'bounties' && (
          <>
            <TouchableOpacity
              onPress={() => router.push('/search/saved-searches')}
              style={s.filterBtn}
              accessibilityRole="button"
              accessibilityLabel="Saved searches"
              accessibilityHint="View and manage saved searches"
            >
              <MaterialIcons name="bookmark-outline" size={20} color={theme.primaryLight} accessibilityElementsHidden={true} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setShowFilters(true)}
              style={s.filterBtn}
              accessibilityRole="button"
              accessibilityLabel={hasActiveFilters ? "Filter (active)" : "Filter"}
              accessibilityHint="Opens filter options for bounty search"
            >
              <MaterialIcons name="tune" size={20} color={hasActiveFilters ? '#fcd34d' : theme.primaryLight} accessibilityElementsHidden={true} />
              {hasActiveFilters && <View style={s.filterDot} />}
            </TouchableOpacity>
          </>
        )}
      </View>
       {/* Tab switcher */}
      <View style={s.tabRow}>
        <TouchableOpacity
          style={[s.tab, activeTab === 'bounties' && s.tabActive]}
          onPress={() => setActiveTab('bounties')}
          accessibilityRole="tab"
          accessibilityLabel="Search bounties"
          accessibilityState={{ selected: activeTab === 'bounties' }}
          accessibilityHint="Switches to bounty search"
        >
          <Text style={[s.tabText, activeTab === 'bounties' && s.tabTextActive]}>
            Bounties
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.tab, activeTab === 'users' && s.tabActive]}
          onPress={() => setActiveTab('users')}
          accessibilityRole="tab"
          accessibilityLabel="Search users"
          accessibilityState={{ selected: activeTab === 'users' }}
          accessibilityHint="Switches to user search"
        >
          <Text style={[s.tabText, activeTab === 'users' && s.tabTextActive]}>
            Users
          </Text>
        </TouchableOpacity>
      </View>
      {/* Autocomplete Suggestions */}
      {showSuggestions && suggestions.length > 0 && (
        <View style={s.suggestionsContainer}>
          {suggestions.map((suggestion) => (
            <TouchableOpacity
              key={suggestion.id}
              style={s.suggestionItem}
              onPress={() => handleSuggestionPress(suggestion)}
              accessibilityRole="button"
              accessibilityLabel={`${suggestion.type === 'bounty' ? 'Bounty' : suggestion.type === 'user' ? 'User' : 'Skill'}: ${suggestion.text}${suggestion.subtitle ? ', ' + suggestion.subtitle : ''}`}
              accessibilityHint={suggestion.type === 'bounty' ? 'Opens bounty details' : suggestion.type === 'user' ? 'Opens user profile' : 'Searches for bounties with this skill'}
            >
              <MaterialIcons
                name={suggestion.icon as any || 'search'}
                size={18}
                color={theme.primaryLight}
                style={s.iconMarginRight10}
              />
              <View style={s.flex1}>
                <Text style={s.suggestionText}>{suggestion.text}</Text>
                {suggestion.subtitle && (
                  <Text style={s.suggestionSubtext}>{suggestion.subtitle}</Text>
                )}
              </View>
              <View style={s.suggestionTypeBadge}>
                <Text style={s.suggestionTypeText}>
                  {suggestion.type === 'bounty' ? 'Bounty' : suggestion.type === 'user' ? 'User' : 'Skill'}
                </Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {error && (
        <View style={s.errorBox}>
          <Text style={s.errorText}>⚠ {error}</Text>
          <TouchableOpacity
            onPress={() => {
              if (activeTab === 'bounties') {
                performBountySearch(query, filters);
              } else {
                performUserSearch(query);
              }
            }}
            style={s.retryBtn}
          >
            <Text style={s.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Recent searches */}
      {!query && recentSearches.length > 0 && (
        <View style={s.recentSection}>
          <View style={s.recentHeader}>
            <Text style={s.recentTitle}>Recent Searches</Text>
            <TouchableOpacity
              onPress={() => recentSearchService.clearAll().then(loadRecentSearches)}
              accessibilityRole="button"
              accessibilityLabel="Clear recent searches"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={s.clearText}>Clear</Text>
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

      {/* Trending Bounties — shown only when search is empty */}
{!query && !isSearching && trendingBounties.length > 0 && (
  <View style={s.trendingSection}>
    <View style={s.trendingHeader}>
      <MaterialIcons name="local-fire-department" size={18} color="#059669" />
      <Text style={s.trendingTitle}>Trending</Text>
    </View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      {trendingBounties.map((bounty) => (
        <TouchableOpacity
          key={String(bounty.id)}
          style={s.trendingCard}
          onPress={() => router.push(`/bounty/${bounty.id}/public`)}
          accessibilityRole="button"
          accessibilityLabel={bounty.title}
          accessibilityHint="Opens bounty details"
        >
          <Text style={s.trendingCardTitle} numberOfLines={2}>
            {bounty.title}
          </Text>
          {bounty.isForHonor ? (
            <View style={s.trendingHonorBadge}>
              <Text style={s.trendingHonorText}>For Honor</Text>
            </View>
          ) : (
            <Text style={s.trendingAmount}>
              ${bounty.amount ?? 0}
            </Text>
          )}
        </TouchableOpacity>
      ))}
    </ScrollView>
  </View>
)}







      {/* Results */}
      {activeTab === 'bounties' ? (
          <FlatList
          data={bountyResults}
          keyExtractor={keyExtractorBounty}
          renderItem={renderBountyItem}
          contentContainerStyle={s.resultsContainer}
          keyboardDismissMode="on-drag"
          ListEmptyComponent={
            query && !isSearching && !error ? (
              <EmptyState
                icon="search-off"
                title="No bounties found"
                description={`No bounties matched "${query}". Try a different keyword or check your spelling.`}
                size="sm"
              />
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
          contentContainerStyle={s.resultsContainer}
          keyboardDismissMode="on-drag"
          ListEmptyComponent={
            query && !isSearching && !error ? (
              <EmptyState
                icon="person-search"
                title="No users found"
                description={`No users matched "${query}". Try a different name or username.`}
                size="sm"
              />
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
        <View style={s.modalOverlay}>
          <View style={s.modalContent}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Filter Bounties</Text>
              <TouchableOpacity onPress={() => setShowFilters(false)}>
                <MaterialIcons name="close" size={24} color={theme.text} />
              </TouchableOpacity>
            </View>

            <ScrollView style={s.filterScroll}>
              {/* Sort By */}
              <Text style={s.filterLabel}>Sort By</Text>
              <View style={s.filterGroup}>
                {[
                  { value: 'date_desc', label: 'Newest First' },
                  { value: 'date_asc', label: 'Oldest First' },
                  { value: 'amount_desc', label: 'Highest Amount' },
                  { value: 'amount_asc', label: 'Lowest Amount' },
                ].map((option) => (
                  <TouchableOpacity
                    key={option.value}
                    style={[
                      s.filterOption,
                      filters.sortBy === option.value && s.filterOptionActive,
                    ]}
                    onPress={() => setFilters({ ...filters, sortBy: option.value as any })}
                  >
                    <Text
                      style={[
                        s.filterOptionText,
                        filters.sortBy === option.value && s.filterOptionTextActive,
                      ]}
                    >
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Status */}
              <Text style={s.filterLabel}>Status</Text>
              <View style={s.filterGroup}>
                {[
                  { value: 'open', label: 'Open' },
                  { value: 'in_progress', label: 'In Progress' },
                  { value: 'completed', label: 'Completed' },
                ].map((option) => (
                  <TouchableOpacity
                    key={option.value}
                    style={[
                      s.filterOption,
                      filters.status?.includes(option.value) && s.filterOptionActive,
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
                        s.filterOptionText,
                        filters.status?.includes(option.value) && s.filterOptionTextActive,
                      ]}
                    >
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Work Type */}
              <Text style={s.filterLabel}>Work Type</Text>
              <View style={s.filterGroup}>
                {[
                  { value: undefined, label: 'All' },
                  { value: 'online', label: 'Online' },
                  { value: 'in_person', label: 'In Person' },
                ].map((option) => (
                  <TouchableOpacity
                    key={option.label}
                    style={[
                      s.filterOption,
                      filters.workType === option.value && s.filterOptionActive,
                    ]}
                    onPress={() => setFilters({ ...filters, workType: option.value as any })}
                  >
                    <Text
                      style={[
                        s.filterOptionText,
                        filters.workType === option.value && s.filterOptionTextActive,
                      ]}
                    >
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Amount Range */}
              <Text style={s.filterLabel}>Amount Range</Text>
              <View style={s.amountRow}>
                <TextInput
                  style={s.amountInput}
                  placeholder="Min"
                  placeholderTextColor={theme.textDisabled}
                  keyboardType="numeric"
                  value={filters.minAmount?.toString() || ''}
                  onChangeText={(text) =>
                    setFilters({ ...filters, minAmount: text ? parseFloat(text) : undefined })
                  }
                />
                <Text style={s.amountSeparator}>-</Text>
                <TextInput
                  style={s.amountInput}
                  placeholder="Max"
                  placeholderTextColor={theme.textDisabled}
                  keyboardType="numeric"
                  value={filters.maxAmount?.toString() || ''}
                  onChangeText={(text) =>
                    setFilters({ ...filters, maxAmount: text ? parseFloat(text) : undefined })
                  }
                />
              </View>
            </ScrollView>

            <View style={s.modalFooter}>
              <TouchableOpacity style={s.clearFiltersBtn} onPress={clearFilters}>
                <Text style={s.clearFiltersBtnText}>Clear All</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={s.applyFiltersBtn}
                onPress={() => setShowFilters(false)}
              >
                <Text style={s.applyFiltersBtnText}>Apply Filters</Text>
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

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: t.background,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingTop: 54,
      paddingHorizontal: SPACING.ELEMENT_GAP,
      paddingBottom: SPACING.ELEMENT_GAP,
      backgroundColor: t.background,
    },
    backBtn: {
      padding: SPACING.COMPACT_GAP,
      marginRight: 4,
    },
    headerTitle: {
      color: t.text,
      fontSize: 18,
      fontWeight: '700',
      marginLeft: 4,
    },
    tabRow: {
      flexDirection: 'row',
      paddingHorizontal: SPACING.ELEMENT_GAP,
      marginBottom: SPACING.COMPACT_GAP,
      gap: SPACING.COMPACT_GAP,
    },
    tab: {
      flex: 1,
      paddingVertical: SPACING.COMPACT_GAP,
      alignItems: 'center',
      backgroundColor: t.surface,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: t.border,
    },
    tabActive: {
      backgroundColor: t.surfaceSecondary,
      borderColor: t.primary,
    },
    tabText: {
      color: t.textSecondary,
      fontSize: 14,
      fontWeight: '600',
    },
    tabTextActive: {
      color: t.primaryLight,
    },
    searchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginHorizontal: SPACING.ELEMENT_GAP,
      backgroundColor: t.surface,
      borderRadius: 999,
      marginBottom: 16,
      paddingVertical: 10,
      paddingHorizontal: 14,
      borderWidth: 1,
      borderColor: t.border,
      shadowColor: '#000',
      shadowOpacity: t.isDark ? 0.3 : 0.06,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
      elevation: 3,
    },
    input: {
      flex: 1,
      color: t.text,
      paddingVertical: 4,
      fontSize: 15,
    },
    searchIconRight: {
      marginLeft: 10,
    },
    iconMarginHorizontal8: {
      marginHorizontal: 8,
      marginRight: 10,
    },
    smallPadding: {
      padding: 4,
    },
    activityMarginRight: {
      marginRight: 8,
    },
    iconMarginRight10: {
      marginRight: 10,
    },
    flex1: {
      flex: 1,
    },
    resultsContainer: {
      padding: 12,
      paddingBottom: 100,
    },
    filterBtn: {
      padding: SPACING.COMPACT_GAP,
      position: 'relative',
    },
    filterDot: {
      position: 'absolute',
      top: 6,
      right: 6,
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: t.primary,
    },
    card: {
      backgroundColor: t.surface,
      borderRadius: 14,
      padding: SPACING.ELEMENT_GAP,
      marginBottom: 10,
      borderWidth: 1,
      borderColor: t.border,
      shadowColor: '#000',
      shadowOpacity: t.isDark ? 0.3 : 0.06,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 3 },
      elevation: 2,
    },
    cardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 4,
    },
    cardTitle: {
      color: t.text,
      fontSize: 15,
      fontWeight: '600',
      flex: 1,
    },
    cardDesc: {
      color: t.textSecondary,
      fontSize: 13,
      marginBottom: 6,
    },
    metaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACING.COMPACT_GAP,
      flexWrap: 'wrap',
    },
    amount: {
      color: t.primary,
      fontWeight: '700',
      fontSize: 13,
    },
    location: {
      color: t.textSecondary,
      fontSize: 11,
      flex: 1,
    },
    time: {
      color: t.textDisabled,
      fontSize: 11,
    },
    // Semantic amber — preserved across themes
    honorBadge: {
      backgroundColor: 'rgba(245,158,11,0.12)',
      paddingHorizontal: SPACING.COMPACT_GAP,
      paddingVertical: 2,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: 'rgba(245,158,11,0.25)',
    },
    honorText: {
      color: '#fbbf24',
      fontSize: 10,
      fontWeight: '700',
    },
    statusBadge: {
      marginTop: 4,
      alignSelf: 'flex-start',
      paddingHorizontal: SPACING.COMPACT_GAP,
      paddingVertical: 2,
      backgroundColor: t.surfaceSecondary,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: t.border,
    },
    statusText: {
      color: t.textSecondary,
      fontSize: 10,
      textTransform: 'capitalize',
    },
    skillsRow: {
      flexDirection: 'row',
      gap: 6,
      marginTop: 6,
      flexWrap: 'wrap',
    },
    skillChip: {
      backgroundColor: t.isDark ? 'rgba(16,185,129,0.12)' : 'rgba(5,150,105,0.08)',
      paddingHorizontal: SPACING.COMPACT_GAP,
      paddingVertical: 4,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: t.isDark ? 'rgba(16,185,129,0.3)' : 'rgba(5,150,105,0.2)',
    },
    skillText: {
      color: t.primaryLight,
      fontSize: 11,
    },
    recentSection: {
      paddingHorizontal: SPACING.ELEMENT_GAP,
      paddingVertical: SPACING.COMPACT_GAP,
    },
    recentHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: SPACING.COMPACT_GAP,
    },
    recentTitle: {
      color: t.text,
      fontSize: 13,
      fontWeight: '600',
    },
    clearText: {
      color: t.primary,
      fontSize: 12,
    },
    recentSearchItem: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: SPACING.COMPACT_GAP,
    },
    recentSearchContent: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACING.COMPACT_GAP,
      flex: 1,
    },
    recentSearchText: {
      color: t.text,
      fontSize: 14,
    },
    // Semantic red — preserved
    errorBox: {
      backgroundColor: 'rgba(239,68,68,0.08)',
      margin: SPACING.ELEMENT_GAP,
      padding: 10,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: 'rgba(239,68,68,0.2)',
    },
    errorText: {
      color: '#f87171',
      marginBottom: 6,
      fontSize: 13,
    },
    retryBtn: {
      backgroundColor: t.primary,
      paddingHorizontal: SPACING.ELEMENT_GAP,
      paddingVertical: 6,
      borderRadius: 20,
      alignSelf: 'flex-start',
    },
    retryText: {
      color: '#ffffff',
      fontSize: 12,
      fontWeight: '600',
    },
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.7)',
      justifyContent: 'flex-end',
    },
    modalContent: {
      backgroundColor: t.surface,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      maxHeight: '80%' as any,
      borderWidth: 1,
      borderColor: t.border,
    },
    modalHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: SPACING.CARD_PADDING,
      borderBottomWidth: 1,
      borderBottomColor: t.border,
    },
    modalTitle: {
      color: t.text,
      fontSize: 18,
      fontWeight: '700',
    },
    filterScroll: {
      padding: SPACING.CARD_PADDING,
    },
    filterLabel: {
      color: t.textSecondary,
      fontSize: 14,
      fontWeight: '600',
      marginBottom: SPACING.COMPACT_GAP,
      marginTop: 12,
    },
    filterGroup: {
      gap: SPACING.COMPACT_GAP,
    },
    filterOption: {
      backgroundColor: t.surfaceSecondary,
      paddingVertical: SPACING.ELEMENT_GAP,
      paddingHorizontal: SPACING.CARD_PADDING,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: t.border,
    },
    filterOptionActive: {
      backgroundColor: t.surface,
      borderColor: t.primary,
    },
    filterOptionText: {
      color: t.textSecondary,
      fontSize: 14,
    },
    filterOptionTextActive: {
      color: t.primaryLight,
      fontWeight: '600',
    },
    amountRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACING.COMPACT_GAP,
    },
    amountInput: {
      flex: 1,
      backgroundColor: t.surfaceSecondary,
      color: t.text,
      paddingVertical: SPACING.ELEMENT_GAP,
      paddingHorizontal: SPACING.CARD_PADDING,
      borderRadius: 8,
      fontSize: 14,
      borderWidth: 1,
      borderColor: t.border,
    },
    amountSeparator: {
      color: t.textDisabled,
      fontSize: 16,
    },
    modalFooter: {
      flexDirection: 'row',
      padding: SPACING.CARD_PADDING,
      gap: SPACING.ELEMENT_GAP,
      borderTopWidth: 1,
      borderTopColor: t.border,
    },
    clearFiltersBtn: {
      flex: 1,
      paddingVertical: SPACING.ELEMENT_GAP,
      alignItems: 'center',
      backgroundColor: t.surfaceSecondary,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: t.border,
    },
    clearFiltersBtnText: {
      color: t.textSecondary,
      fontSize: 14,
      fontWeight: '600',
    },
    applyFiltersBtn: {
      flex: 1,
      paddingVertical: SPACING.ELEMENT_GAP,
      alignItems: 'center',
      backgroundColor: t.primary,
      borderRadius: 8,
      shadowColor: t.primary,
      shadowOpacity: 0.3,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 3 },
      elevation: 3,
    },
    applyFiltersBtnText: {
      color: '#ffffff',
      fontSize: 14,
      fontWeight: '700',
    },
    suggestionsContainer: {
      marginHorizontal: SPACING.ELEMENT_GAP,
      backgroundColor: t.surface,
      borderRadius: 12,
      marginBottom: SPACING.COMPACT_GAP,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: t.border,
    },
    suggestionItem: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: SPACING.ELEMENT_GAP,
      paddingHorizontal: 14,
      borderBottomWidth: 1,
      borderBottomColor: t.border,
    },
    suggestionText: {
      color: t.text,
      fontSize: 14,
      fontWeight: '500',
    },
    suggestionSubtext: {
      color: t.textSecondary,
      fontSize: 11,
      marginTop: 2,
    },
    suggestionTypeBadge: {
      backgroundColor: t.isDark ? 'rgba(16,185,129,0.12)' : 'rgba(5,150,105,0.08)',
      paddingHorizontal: SPACING.COMPACT_GAP,
      paddingVertical: 3,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: t.isDark ? 'rgba(16,185,129,0.3)' : 'rgba(5,150,105,0.2)',
    },
    suggestionTypeText: {
      color: t.primaryLight,
      fontSize: 10,
      fontWeight: '600',
    },
    trendingSection: {
      marginBottom: 12,
      paddingHorizontal: SPACING.ELEMENT_GAP,
    },
    trendingHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginBottom: 10,
    },
    trendingTitle: {
      color: t.text,
      fontSize: 15,
      fontWeight: '600',
    },
    // Gold border/amount kept as decorative accent for trending cards
    trendingCard: {
      width: 200,
      backgroundColor: t.surface,
      borderRadius: 12,
      padding: 16,
      marginRight: 10,
      borderWidth: 1.5,
      borderColor: '#D4AF37',
      gap: 80,
      shadowColor: '#D4AF37',
      shadowOpacity: 0.25,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 2 },
      elevation: 3,
    },
    trendingCardTitle: {
      color: t.text,
      fontSize: 13,
      fontWeight: '600',
    },
    trendingAmount: {
      color: '#D4AF37',
      fontSize: 14,
      fontWeight: '700',
    },
    // Semantic amber — preserved
    trendingHonorBadge: {
      backgroundColor: 'rgba(245,158,11,0.12)',
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 6,
      alignSelf: 'flex-start',
      borderWidth: 1,
      borderColor: 'rgba(245,158,11,0.25)',
    },
    trendingHonorText: {
      color: '#fbbf24',
      fontSize: 11,
      fontWeight: '700',
    },
  })
}