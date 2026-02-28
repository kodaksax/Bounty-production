# Search and Filtering Implementation Guide

## Overview

This document describes the comprehensive search and filtering functionality implemented for BOUNTYExpo, allowing users to search and filter both bounties and users with various criteria.

## Features

### Bounty Search
- **Keyword Search**: Search in title and description
- **Location Filter**: Filter by location (optional)
- **Amount Range**: Filter by minimum and maximum amount
- **Status Filter**: Filter by bounty status (open, in_progress, completed)
- **Work Type**: Filter by online or in-person work
- **Honor Bounties**: Filter for honor-only bounties
- **Sort Options**:
  - Date (newest/oldest first)
  - Amount (highest/lowest first)
  - Distance (closest first - for future implementation)

### User Search
- **Keyword Search**: Search by username, name, or bio
- **Skills Filter**: Filter by user skills
- **Location Filter**: Filter by user location
- **Sort Options**:
  - Relevance
  - Followers (most followed)
  - Join date (newest first)

### Recent Searches
- Stores up to 10 recent searches per type (bounty/user)
- Prevents duplicates (updates timestamp on re-search)
- Allows clearing individual or all searches
- Persists across app sessions using AsyncStorage

## Architecture

### Frontend Components

#### Search Screen (`app/tabs/search.tsx`)
Main search interface with:
- Tab switcher for Bounties/Users
- Search input with debouncing (300ms)
- Filter button (bounties only) with indicator
- Recent searches section
- Results list with cards
- Filter modal

#### Key Features:
- **Debouncing**: Reduces API calls by waiting 300ms after user stops typing
- **Optimistic UI**: Shows loading states and error handling
- **Recent Search History**: Displays and manages search history
- **Responsive Filters**: Modal-based filter UI with clear/apply actions

### Backend Services

#### Bounty Service (`lib/services/bounty-service.ts`)
```typescript
async searchWithFilters(filters: {
  keywords?: string;
  location?: string;
  minAmount?: number;
  maxAmount?: number;
  status?: string[];
  workType?: 'online' | 'in_person';
  isForHonor?: boolean;
  skills?: string[];
  sortBy?: 'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc';
  limit?: number;
  offset?: number;
}): Promise<Bounty[]>
```

#### User Search Service (`lib/services/user-search-service.ts`)
```typescript
async searchUsers(filters: UserSearchFilters): Promise<SearchResult<UserProfile>>
async getUserByUsername(username: string): Promise<UserProfile | null>
async getUserSuggestions(query: string, limit?: number): Promise<UserProfile[]>
```

#### Recent Search Service (`lib/services/recent-search-service.ts`)
```typescript
async getRecentSearches(): Promise<RecentSearch[]>
async saveSearch(type: 'bounty' | 'user', query: string, filters?: any): Promise<void>
async removeSearch(searchId: string): Promise<void>
async clearAll(): Promise<void>
```

### API Endpoints

#### `/api/bounties/search` (GET)
Query parameters:
- `keywords` - Search keywords
- `location` - Location filter
- `minAmount` - Minimum amount (in dollars)
- `maxAmount` - Maximum amount (in dollars)
- `status` - Status filter
- `workType` - Work type (online/in_person)
- `isForHonor` - Honor bounties only (true/false)
- `sortBy` - Sort option
- `limit` - Results per page (max 100)
- `offset` - Pagination offset

Response:
```json
{
  "results": [...],
  "total": 50,
  "page": 1,
  "pageSize": 20,
  "hasMore": true
}
```

#### `/api/users/search` (GET)
Query parameters:
- `keywords` - Search keywords
- `skills` - Skills filter (comma-separated)
- `location` - Location filter
- `sortBy` - Sort option
- `limit` - Results per page
- `offset` - Pagination offset

#### `/api/search/suggestions` (GET)
Query parameters:
- `q` - Query string (min 2 characters)
- `type` - 'bounty' or 'user'

Returns up to 5 suggestions for autocomplete.

## Data Flow

### Search Flow
1. User types in search input
2. 300ms debounce timer starts
3. After delay, `performBountySearch()` or `performUserSearch()` is called
4. Service layer makes API call (or uses Supabase directly)
5. Results are displayed in cards
6. Search is saved to recent searches (if query not empty)

### Filter Flow
1. User clicks filter button
2. Modal opens with current filter state
3. User selects/changes filters
4. "Apply Filters" triggers new search with updated filters
5. Modal closes and results update

### Recent Searches Flow
1. On screen mount, load recent searches for current tab
2. Display searches in chronological order (newest first)
3. Clicking a recent search repopulates search input and filters
4. Remove button deletes individual search
5. Clear button removes all recent searches

## Type Definitions

```typescript
// Search filter types
interface BountySearchFilters {
  keywords?: string;
  location?: string;
  minAmount?: number;
  maxAmount?: number;
  status?: string[];
  workType?: 'online' | 'in_person';
  isForHonor?: boolean;
  skills?: string[];
  sortBy?: BountySortOption;
  limit?: number;
  offset?: number;
}

interface UserSearchFilters {
  keywords?: string;
  skills?: string[];
  location?: string;
  verificationStatus?: 'unverified' | 'pending' | 'verified';
  sortBy?: UserSortOption;
  limit?: number;
  offset?: number;
}

// Result wrapper
interface SearchResult<T> {
  results: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

// Recent search storage
interface RecentSearch {
  id: string;
  type: 'bounty' | 'user';
  query: string;
  filters?: BountySearchFilters | UserSearchFilters;
  timestamp: string;
}
```

## Usage Examples

### Frontend: Basic Bounty Search
```typescript
import { bountyService } from 'lib/services/bounty-service';

const results = await bountyService.searchWithFilters({
  keywords: 'web development',
  minAmount: 100,
  maxAmount: 1000,
  status: ['open'],
  sortBy: 'date_desc',
  limit: 20,
});
```

### Frontend: User Search
```typescript
import { userSearchService } from 'lib/services/user-search-service';

const result = await userSearchService.searchUsers({
  keywords: 'john',
  skills: ['React', 'Node.js'],
  limit: 20,
});
```

### Frontend: Managing Recent Searches
```typescript
import { recentSearchService } from 'lib/services/recent-search-service';

// Save a search
await recentSearchService.saveSearch('bounty', 'mobile app', {
  minAmount: 500,
  sortBy: 'amount_desc',
});

// Load recent searches
const searches = await recentSearchService.getRecentSearchesByType('bounty');

// Remove a search
await recentSearchService.removeSearch(searchId);

// Clear all
await recentSearchService.clearAll();
```

### Backend: API Usage
```bash
# Search bounties
curl "http://localhost:3001/api/bounties/search?keywords=design&minAmount=100&maxAmount=500&sortBy=amount_desc"

# Search users
curl "http://localhost:3001/api/users/search?keywords=developer&limit=10"

# Get suggestions
curl "http://localhost:3001/api/search/suggestions?q=web&type=bounty"
```

## Performance Considerations

1. **Debouncing**: 300ms delay prevents excessive API calls during typing
2. **Pagination**: Results limited to 20-100 items per request
3. **Caching**: Recent searches stored locally in AsyncStorage
4. **Optimistic UI**: Loading states prevent multiple simultaneous requests
5. **Database Indexing**: Consider adding indexes on frequently searched fields:
   - `bounties.title`
   - `bounties.description`
   - `bounties.status`
   - `bounties.amount_cents`
   - `users.handle`

## Future Enhancements

1. **Full-Text Search**: Implement PostgreSQL `tsvector` for better text search
2. **Distance-Based Sorting**: Add geolocation-based sorting for in-person bounties
3. **Search Analytics**: Track popular searches for insights
4. **Advanced Filters**:
   - Skills required for bounties
   - Date range filters
   - Verification status for users
5. **Search History Sync**: Sync recent searches across devices (requires backend storage)
6. **Autocomplete**: Real-time suggestions as user types
7. **Saved Searches**: Allow users to save frequently used filter combinations

## Testing

### Validation Tests
Run the validation test to ensure all components are in place:
```bash
node tests/search-validation.js
```

### Manual Testing Checklist
- [ ] Basic keyword search works for bounties
- [ ] Basic keyword search works for users
- [ ] Tab switching preserves search state
- [ ] Filters apply correctly
- [ ] Sort options work
- [ ] Recent searches save and load
- [ ] Duplicate searches update timestamp
- [ ] Remove recent search works
- [ ] Clear all recent searches works
- [ ] Empty states display correctly
- [ ] Error states display correctly
- [ ] Loading states show during search
- [ ] Results navigate to detail screens

## Troubleshooting

### Search returns no results
- Check if Supabase is configured (`EXPO_PUBLIC_SUPABASE_URL`)
- Verify database contains test data
- Check API server is running (port 3001)
- Inspect browser/app console for errors

### Filters not applying
- Ensure filter values are properly formatted
- Check API endpoint receives correct query parameters
- Verify database schema supports filtered fields

### Recent searches not persisting
- Check AsyncStorage permissions
- Verify app has storage access
- Clear app data and retry

## Security Considerations

- ✅ All API endpoints require authentication (`authMiddleware`)
- ✅ SQL injection prevented by using parameterized queries (Drizzle ORM)
- ✅ Input validation on backend (limit max values)
- ✅ XSS prevention through React's automatic escaping
- ✅ Rate limiting recommended for production (not implemented)

## Conclusion

The search and filtering implementation provides a comprehensive, performant, and user-friendly way to discover bounties and users in the BOUNTYExpo platform. The modular architecture allows for easy extension and enhancement of search capabilities in the future.
