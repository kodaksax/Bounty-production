# Admin Section Documentation

## Overview

The Admin section provides internal/staff users with a mobile interface to manage bounties, users, and transactions within the BountyExpo app. It is built using React Native + Expo Router and follows the existing mobile architecture patterns.

## Architecture

### Route Structure
- **Route Group**: `app/(admin)/`
- **Gating**: Routes are protected by `AdminProvider` context - non-admin users are redirected
- **Screens**:
  - `/` - AdminDashboard (metrics overview)
  - `/bounties` - AdminBountiesList (with filters)
  - `/bounty/[id]` - AdminBountyDetail (status management)
  - `/users` - AdminUsersList
  - `/user/[id]` - AdminUserDetail
  - `/transactions` - AdminTransactionsList (read-only)

### Context & Authentication
- **AdminContext** (`lib/admin-context.tsx`): Manages `isAdmin` state
- Persisted in AsyncStorage under key `BE:isAdmin`
- Access via `useAdmin()` hook
- `useRequireAdmin()` hook for guarded routes

### Data Layer
All admin data is currently **mocked** via `lib/admin/adminDataClient.ts`:
- Simulates network delay (500ms)
- In-memory mock data for bounties, users, transactions
- Optional failure simulation via `DEBUG_SIMULATE_FAILURES` flag
- Methods:
  - `fetchAdminMetrics()` - Dashboard stats
  - `fetchAdminBounties(filters)` - List bounties with status filter
  - `fetchAdminBountyById(id)` - Get single bounty
  - `updateBountyStatus(id, status)` - Transition bounty status
  - `fetchAdminUsers(filters)` - List users
  - `fetchAdminUserById(id)` - Get single user
  - `fetchAdminTransactions(filters)` - List transactions

### Custom Hooks
Located in `hooks/`:
- `useAdminMetrics()` - Dashboard metrics with loading/error/retry
- `useAdminBounties(filters)` - Bounties list with status updates
- `useAdminUsers(filters)` - Users list
- `useAdminTransactions(filters)` - Transactions list

Each hook provides:
- `data` - The fetched data
- `isLoading` - Loading state
- `error` - Error message (string | null)
- `refetch()` - Manual refresh function

### UI Components
Reusable admin components in `components/admin/`:
- **AdminHeader** - Consistent header with "ADMIN" badge and optional back button
- **AdminCard** - Card container with emerald theme
- **AdminStatusBadge** - Color-coded status badges for bounties/users/transactions
- **AdminStatRow** - Key-value row for metrics

### Types
Admin-specific types in `lib/types-admin.ts`:
- `AdminMetrics` - Dashboard overview stats
- `AdminBounty` - Extended bounty with admin fields (flaggedCount, lastModified)
- `AdminUserSummary` - User with stats (posted/accepted/completed counts, balance)
- `AdminTransaction` - Transaction details (type, amount, status, users)
- Filter types for each list (status, verification, etc.)

## Navigation Integration

### BottomNav Enhancement
- `BottomNav` component now accepts optional `showAdmin` prop
- When `isAdmin === true`, the last tab shows "admin" icon instead of "profile"
- Clicking admin tab navigates to `/(admin)/` route group
- Profile remains accessible via settings or direct navigation

### Layout
- Admin screens do **not** render BottomNav internally (single source in `BountyApp`)
- Screens use `ScrollView` with bottom padding to avoid nav overlap
- `AdminHeader` provides consistent back navigation within admin section

## Enabling Admin Mode

### Dev Mode Toggle (Temporary)
In **development only** (`__DEV__`), a toggle is available in:
1. Navigate to Profile → Settings (gear icon)
2. Scroll to "Developer Tools" section
3. Toggle "Admin Mode" switch
4. An alert confirms the change
5. Return to home and see the admin tab appear in BottomNav

### Production (Future)
For production, replace the toggle with:
- Real authentication roles from backend
- JWT claims or user profile field
- Role-based access control (RBAC)

## Features

### AdminDashboard
- Quick access cards to Bounties, Users, Transactions
- Metrics overview:
  - Total bounties (by status: open, in_progress, completed, archived)
  - Total users
  - Escrow volume
  - Transaction count
- Pull-to-refresh to reload metrics
- Error handling with retry button

### AdminBountiesList
- Filterable by status: all, open, in_progress, completed, archived
- Displays: title, description, amount/honor, location, date
- Flagged bounties highlighted with warning banner
- Tap to view detail
- Pull-to-refresh
- Empty and error states

### AdminBountyDetail
- Full bounty information
- Status badge and flagged indicator
- Status transition buttons:
  - Open → In Progress, Archive
  - In Progress → Complete, Reopen, Archive
  - Completed → Archive
  - Archived → Reopen
- Confirmation dialog before status change
- Optimistic UI updates

### AdminUsersList
- Filterable by status: all, active, suspended, banned
- Shows username, email, verification badge
- Stats: posted, completed, balance
- Join date
- Tap to view detail
- Pull-to-refresh

### AdminUserDetail
- User profile header with status + verification badges
- Activity stats grid (posted, accepted, completed)
- Financial summary (balance, spent, earned)
- Account information (ID, join date, status)

### AdminTransactionsList
- Filterable by type: all, escrow, release, refund, deposit, withdrawal
- Shows type icon, description, amount, status
- Related bounty/user IDs
- Timestamp
- Read-only (no actions available yet)

## Error Handling

All screens implement:
1. **Loading state**: Spinner during initial fetch
2. **Empty state**: Friendly message with refresh button when no data
3. **Error state**: Error icon + message + retry button
4. **Inline errors**: Error banners that can be dismissed

Network errors are simulated randomly when `DEBUG_SIMULATE_FAILURES = true` in `adminDataClient.ts`.

## Future Enhancements

### Near Term
- Real backend integration (replace mock client)
- Search bars for users and bounties
- Moderation queue (flagged items)
- User actions (suspend, ban, verify)

### Medium Term
- Analytics charts (bounty trends, user growth)
- Bulk actions (bulk status change, export data)
- Audit logs (track admin actions)
- Push notifications for urgent flags

### Long Term
- Role-based permissions (super admin, moderator)
- Dispute resolution flow
- Payment/wallet mutation operations
- Integration with external admin tools

## Development Notes

### Adding New Screens
1. Create screen file in `app/(admin)/`
2. Follow existing patterns (AdminHeader, error handling, FlatList)
3. Add route link to AdminDashboard quick actions
4. Add corresponding mock data to `adminDataClient.ts`

### Styling Guidelines
- Use emerald theme colors (`#00912C`, `#00dc50`, `#1a3d2e`, `#2d5240`)
- Match existing spacing and typography
- Test on both iOS and Android
- Ensure safe area insets are respected

### Type Safety
- All new types go in `lib/types-admin.ts`
- Avoid polluting `lib/types.ts` unless truly core
- Run `npx tsc --noEmit` before committing

### Performance
- Use FlatList for lists (not ScrollView + map)
- Memoize expensive computations
- Avoid heavy re-renders in hooks

## Testing Checklist

- [ ] Non-admin user cannot access `/admin` routes (redirects)
- [ ] Admin toggle in settings works (dev mode only)
- [ ] Admin tab appears/disappears when toggling
- [ ] Dashboard loads metrics correctly
- [ ] All list screens have working filters
- [ ] Detail screens load individual items
- [ ] Status transitions update UI optimistically
- [ ] Error states show retry button
- [ ] Empty states show helpful messages
- [ ] Pull-to-refresh works on all lists
- [ ] No console errors during navigation
- [ ] TypeScript compiles without errors
- [ ] Layout works on iOS and Android
- [ ] BottomNav does not duplicate
- [ ] Back button navigates correctly

## Questions?

For issues or feature requests, open a discussion or PR with:
- Clear description of problem/feature
- Screenshots if UI-related
- Steps to reproduce (for bugs)
