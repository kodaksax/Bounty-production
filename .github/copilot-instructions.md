# Copilot Instructions for BOUNTYExpo

## Mission & Elevator Pitch
- Purpose: Make it fast and safe for people to post small jobs (“bounties”), get matched, coordinate via chat, and settle funds.
- Vision: A trustable, mobile-first marketplace with simple flows: Create → Match → Chat → Complete → Settle.

## Users & Value
- Poster: Wants to quickly post a task, set budget/location, review applicants, and pay only on completion (escrow).
- Hunter: Wants to discover nearby or relevant tasks, accept, message the poster, and get paid reliably.
- Value props: Speed, transparency, escrow-backed trust, mobile-first simplicity.

## Core Flows (happy paths)
1) Create Bounty
   - Postings > New > title, description, amount or honor, optional location > confirm > visible in “Postings”.
2) Accept & Coordinate
   - Hunter browses Postings > opens detail > applies/accepts > chat starts in Messenger.
3) Complete & Settle
   - Wallet escrows funds on accept > completion triggers release > both parties see history.
4) Schedule
   - Optional due date appears in Calendar (read-only summary for now).

## Domain Glossary (be consistent)
- Bounty: A task with title, description, amount|isForHonor, optional location.
- Posting: A bounty in the public feed (open status).
- Request: A proposal or acceptance state on a bounty.
- Conversation: 1:1 or group chat tied to a bounty/request.
- Wallet: Escrow + transactions.
- Calendar: Dates tied to bounties (start/due).

## Data Contracts (authoritative shapes)
```ts
// lib/types.ts (source of truth)
export type Money = number; // USD for now

export interface Bounty {
  id: string;
  user_id: string;
  title: string;
  description: string;
  amount?: Money;
  isForHonor?: boolean;
  location?: string;
  createdAt?: string;
  status?: "open" | "in_progress" | "completed" | "archived";
}

export interface Conversation {
  id: string;
  bountyId?: string;
  isGroup: boolean;
  name: string;
  avatar?: string;
  lastMessage?: string;
  updatedAt?: string;
}

export interface WalletTransaction {
  id: string;
  type: "escrow" | "release" | "refund";
  amount: Money;
  bountyId?: string;
  createdAt: string;
}
```

## Navigation & Layout (Expo Router + BottomNav)
- Routing uses Expo Router (app/ file-based routes).
- BottomNav is rendered ONCE at the root (BountyApp). Do not render nav inside screens.
- Mapping:
  - create → Messenger
  - wallet → WalletScreen
  - bounty → Dashboard/Home
  - postings → PostingsScreen
  - calendar → Calendar view
- Positioning rules:
  - BountyApp root View: position: 'relative'; flex: 1; paddingBottom to clear the nav.
  - BottomNav container: position: 'absolute'; left: 0; right: 0; bottom: 0; zIndex high.
  - If nav Y-position is adjusted, increase container paddingBottom equivalently.

## UI/UX Principles
- Mobile-first, emerald theme (emerald-600/700/800).
- Keep actions within thumb reach; center “bounty” button looks primary.
- Respect safe areas (iOS) and ensure content padding avoids nav overlap.
- Empty states > spinners; show helpful copy and one primary action.

## State & Data
- Lift navigation state to BountyApp; pass down via props (activeScreen, onNavigate).
- Avoid duplicating local “activeScreen” in child screens.
- For async data, prefer hooks in hooks/ and services in lib/services/.

## Error Handling & Empty States
- Wrap network calls; show inline error banners with dismiss “✕”.
- Don’t block render on fetch failures; show cached/empty UI with Retry.

## Performance & Quality
- Run typecheck before PRs: `npx tsc --noEmit`
- Prefer FlatList for long lists; avoid heavy re-renders in chat/postings.
- Use memoization where needed (React.memo/useMemo/useCallback).

## Styling & Theming
- Use existing tailwind-like className patterns + RN StyleSheet for tricky cases.
- Ensure RN component capitalization (ScrollView, SafeAreaView, etc.).
- Use StyleSheet from "react-native" (not `import type`), e.g., `import { StyleSheet } from "react-native"`.

## AI Collaboration Guidelines (Do/Don’t)
Do:
- Use 4-backtick fenced code blocks and include filepath comments.
- Provide patch-like edits with `// ...existing code...` markers.
- Keep one source of truth for BottomNav in BountyApp.
- Add bottom padding to screens so nav doesn’t cover content.

Don’t:
- Don’t render BottomNav inside screens.
- Don’t introduce local `activeScreen` conflicting with app-level setter.
- Don’t leave unmatched JSX tags; always close ScrollView, View, and wrappers.
- Don’t import `type StyleSheet`; import the value from react-native.

## Example: Using the shared BottomNav correctly
- BountyApp:
```tsx
<BottomNav activeScreen={activeScreen} onNavigate={setActiveScreen} />
```
- Screens (Messenger/Postings/Wallet/Profile): no BottomNav; add bottom padding if content scrolls.

## Commands & Workflows
- Install: `npm install`
- Start: `npx expo start`
- Reset Metro cache if layout glitches occur: `npx expo start --clear`
- Typecheck: `npx tsc --noEmit`

## Roadmap Signals (for AI)
- Short term: Polish posting flow, chat stability, wallet mock flows.
- Medium term: Real escrow integration, invitations/applications, better calendar integration.
- Long term: Trust/safety features, ratings, dispute resolution.
