# Copilot Instructions — BOUNTYExpo

This file provides concise, repo-specific guidance for AI coding agents working on BOUNTYExpo.

Key pointers
- Language & runtime: TypeScript + React (Expo/React Native). See `App.tsx` and `app/` routes.
- Backend: server and `services/api` (see `../server/README.md` and `../services/api/README.md`).
- Auth & DB: Supabase migrations live under `supabase/`; data models in `lib/types.ts`.

Architecture & data flow (high-level)
- Mobile app (app/) ↔ services/api (server) ↔ Supabase/Stripe. Core domain shapes: `Bounty` → `Posting` → `Request` → `Conversation` → `WalletTransaction` (see `lib/types.ts`).
- UI routing uses Expo Router (file-based routes under `app/`). Bottom nav is global — do NOT render BottomNav inside screens.

Patterns and conventions to follow
- File placement: screens in `app/`, shared UI in `lib/components` or `components/ui/`, hooks in `hooks/`, services in `lib/services/`.
- Naming: `PascalCase` for React components/types, `camelCase` for functions/vars, `kebab-case` for filenames and folders.
- Keep code small and focused: prefer utility hooks in `hooks/` and thin presentational components under `components/`.
- Use `lib/types.ts` as the canonical shapes for domain objects.

Critical developer workflows (commands)
- Install deps: `npm install`
- Start app (Expo): `npx expo start` (use `--clear` to reset Metro cache)
- Typecheck: `npx tsc --noEmit`
- Server docs & startup: see [server/README.md](../server/README.md)
- Run migrations: follow `supabase/migrations/README.md` (or scripts in `scripts/`).

Project-specific rules for AI edits
- Preserve navigation patterns: update only `app/` routes when adding screens and ensure `BottomNav` remains root-level.
- Update `lib/types.ts` only when adding fields globally; adjust both app and server docs when changing domain shapes.
- Follow existing style — minimal diffs, no sweeping reformatting.
- When adding dependencies, update `package.json` and include exact install commands in PR notes.

Integration points to check in PRs
- Supabase usage (migrations and client setup)
- Payments (Stripe) — server-side code under `server/` and docs in `server/README.md`
- Push notifications / analytics — search for `PUSH` or `analytics` in repo for integration touchpoints

Examples (where to look)
- Bottom navigation guidance: see `BOTTOM_NAV_AUDIT_REPORT.md` and `BOUNTY_DASHBOARD_IMPLEMENTATION.md` for examples of correct placement.
- Domain shapes & types: `lib/types.ts` and `BOUNTY_*` docs.
- Messaging & convo patterns: `MESSAGING_IMPLEMENTATION.md` and `MESSENGER_QOL_README.md`.

Testing & validation
- Run `npx tsc --noEmit` on all changes.
- If UI-affecting, preview in Expo (`npx expo start`) and include screenshots / device tested notes in PR.

When to ask for clarification
- Any change touching escrow/payments, auth flows, or database migrations — ask a human reviewer.

Reporting back
- Use the todo list when multi-step changes are required.
- In PR descriptions, list touched domains (navigation, payments, migrations, messaging).

If anything here is unclear or missing, tell me which area you want expanded (navigation, server, payments, or CI/workflows).
# Copilot Instructions for BOUNTYExpo

## Mission & Elevator Pitch
- Purpose: Make it fast and safe for people to post small jobs ("bounties"), get matched, coordinate via chat, and settle funds.
- Vision: A trustable, mobile-first marketplace with simple flows: Create → Match → Chat → Complete → Settle.
- Core value: Trust through transparency, simplicity and reliability in the gig economy.

## Context Interpretation Framework
When interpreting requests about the BOUNTYExpo project, consider these layers of context:

1. **Domain Intent Layer**: Understand if the request relates to bounty creation, matching, chat, completion, or payment processes.
2. **Technical Implementation Layer**: Identify which system components (UI, state, API, navigation) are involved.
3. **User Perspective Layer**: Determine if the solution primarily affects posters or hunters.
4. **Architectural Constraints**: Ensure solutions follow the established patterns (Expo Router, component hierarchy, state management).

When faced with ambiguity, prioritize:
- Mobile usability over complex features
- Consistency with existing patterns over novel approaches
- User trust and transparency over technical elegance

## Users & Value
- **Poster**: Wants to quickly post a task, set budget/location, review applicants, and pay only on completion (escrow).
  - *Primary concerns*: Quality results, reliable completion, clear communication
- **Hunter**: Wants to discover nearby or relevant tasks, accept, message the poster, and get paid reliably.
  - *Primary concerns*: Finding suitable work, fair treatment, guaranteed payment
- **Value props**: Speed, transparency, escrow-backed trust, mobile-first simplicity.

## Core Flows (happy paths)
1) **Create Bounty**
   - Postings > New > title, description, amount or honor, optional location > confirm > visible in "Postings".
   - *Implicit requirements*: Form validation, location privacy options, draft saving

2) **Accept & Coordinate**
   - Hunter browses Postings > opens detail > applies/accepts > chat starts in Messenger.
   - *Implicit requirements*: Profile visibility, notification triggers, status tracking

3) **Complete & Settle**
   - Wallet escrows funds on accept > completion triggers release > both parties see history.
   - *Implicit requirements*: Dispute resolution access, transaction records, receipt generation

4) **Schedule**
   - Optional due date appears in Calendar (read-only summary for now).
   - *Implicit requirements*: Timezone handling, reminder creation, deadline notifications

## Domain Glossary with Relationship Mapping
- **Bounty**: A task with title, description, amount|isForHonor, optional location.
  - *Creates*: Posting, Requests, Conversation, WalletTransaction
  - *Belongs to*: User (poster)

- **Posting**: A bounty in the public feed (open status).
  - *Parent*: Bounty
  - *Generates*: Requests, Calendar events

- **Request**: A proposal or acceptance state on a bounty.
  - *Links*: Bounty, User (hunter)
  - *Triggers*: Conversation, WalletTransaction (on accept)

- **Conversation**: 1:1 or group chat tied to a bounty/request.
  - *Participants*: User (poster), User(s) (hunters)
  - *Context*: Bounty details, completion status

- **Wallet**: Escrow + transactions.
  - *Contains*: WalletTransactions
  - *Interacts with*: Bounty status changes

## Contextual Decision Matrix
When requirements are ambiguous, use this matrix to guide implementation decisions:

| Context Scenario | Decision Priority | Secondary Consideration | Avoid |
|------------------|-------------------|-------------------------|-------|
| UI Interaction   | Thumb-friendly navigation | Visual feedback | Complex gestures |
| Data Loading     | Optimistic UI with fallback | Loading indicators | Blocking UI |
| Error Handling   | Helpful recovery actions | Clear error messaging | Technical details |
| Form Completion  | Progressive disclosure | Field validation | Multi-step complexity |
| Chat Features    | Reliable message delivery | Status indicators | Heavy attachments |
| Payment Flows    | Transparency and confirmation | Transaction details | Friction in release |

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
  
- Positioning rules:
  - BountyApp root View: position: 'relative'; flex: 1; paddingBottom to clear the nav.
  - BottomNav container: position: 'absolute'; left: 0; right: 0; bottom: 0; zIndex high.
  - If nav Y-position is adjusted, increase container paddingBottom equivalently.

### Navigation Context Recognition
When analyzing navigation-related requests, consider:
- Is this a route change or in-screen navigation?
- Does it require passing parameters between screens?
- Will this affect the navigation stack history?
- How does this interact with the BottomNav global state?

## UI/UX Principles
- Mobile-first, emerald theme (emerald-600/700/800).
- Keep actions within thumb reach; center "bounty" button looks primary.
- Respect safe areas (iOS) and ensure content padding avoids nav overlap.
- Empty states > spinners; show helpful copy and one primary action.

### UI/UX Context Hierarchy
When implementing UI changes, prioritize in this order:
1. User trust and safety (confirmation, clarity, data protection)
2. Task completion efficiency (minimal steps, clear progression)
3. Visual consistency (follow established patterns)
4. Delight and polish (animations, transitions, microcopy)

## State & Data
- Lift navigation state to BountyApp; pass down via props (activeScreen, onNavigate).
- Avoid duplicating local "activeScreen" in child screens.
- For async data, prefer hooks in hooks/ and services in lib/services/.

### State Change Patterns
Identify which type of state change is needed:
- **Transient UI state**: Use local useState (toggles, form inputs, etc.)
- **Shared component state**: Use props/callbacks or context for related components
- **Application state**: Use centralized state management for cross-screen data
- **Persisted state**: Use secure storage or API for data that survives sessions

## Error Handling & Empty States
- Wrap network calls; show inline error banners with dismiss "✕".
- Don't block render on fetch failures; show cached/empty UI with Retry.

### Error Context Classification
When handling errors, categorize by:
- **User recoverable**: Show action to fix (retry, edit input, etc.)
- **System recoverable**: Handle silently with fallback + optional alert
- **Fatal/blocking**: Clear error with support contact and alternative path
- **Data integrity**: Protect against data loss with confirmation

## Performance & Quality
- Run typecheck before PRs: `npx tsc --noEmit`
- Prefer FlatList for long lists; avoid heavy re-renders in chat/postings.
- Use memoization where needed (React.memo/useMemo/useCallback).

## Styling & Theming
- Use existing tailwind-like className patterns + RN StyleSheet for tricky cases.
- Ensure RN component capitalization (ScrollView, SafeAreaView, etc.).
- Use StyleSheet from "react-native" (not `import type`), e.g., `import { StyleSheet } from "react-native"`.

## Assumption Identification Framework
When information is incomplete, identify and clarify assumptions using this framework:

1. **Explicit requirements**: What has been directly stated in the request?
2. **Implicit requirements**: What must be true for the explicit requirements to work?
3. **Unstated constraints**: What existing patterns must be maintained?
4. **User expectations**: What would users expect given the context?

Present these assumptions explicitly when proposing solutions:

```
Based on your request, I'm making these assumptions:
1. This component needs to maintain the existing theme
2. You want to preserve the current navigation pattern
3. Error handling should follow existing patterns
4. This should work on both iOS and Android

My solution addresses these by... [explanation]
```

## AI Collaboration Guidelines (Do/Don't)
Do:
- Use 4-backtick fenced code blocks and include filepath comments.
- Provide patch-like edits with `// ...existing code...` markers.
- Keep one source of truth for BottomNav in BountyApp.
- Add bottom padding to screens so nav doesn't cover content.
- Explicitly identify which parts of the architecture your solution impacts.
- Suggest testing approaches for complex changes.
- Recognize implicit requirements based on context.

Don't:
- Don't render BottomNav inside screens.
- Don't introduce local `activeScreen` conflicting with app-level setter.
- Don't leave unmatched JSX tags; always close ScrollView, View, and wrappers.
- Don't import `type StyleSheet`; import the value from react-native.
- Don't make assumptions about API responses without checking types.
- Don't reinvent patterns that already exist in the codebase.
- Don't overlook platform-specific behaviors (iOS vs Android).

### Context-Sensitive Response Examples

**Example 1: Simple vs. Complex Context Recognition**

User request: "Add a button to cancel a bounty"

Poor response:
```tsx
// Here's a button component:
<Button title="Cancel Bounty" onPress={() => cancelBounty()} />
```

Good response:
```tsx
This requires updates in multiple places since canceling a bounty impacts:
1. The bounty status in the database
2. The UI for both poster and any hunters
3. Potential wallet transactions if funds are escrowed
4. Active conversations related to the bounty

Here's how I suggest implementing this:

First, update the types to support cancellation:
```tsx name=lib/types.ts
// Update the status type to include "cancelled"
export interface Bounty {
  // ...existing code...
  status?: "open" | "in_progress" | "completed" | "archived" | "cancelled";
}

// Add a transaction type for refunds
export interface WalletTransaction {
  // ...existing code...
  type: "escrow" | "release" | "refund" | "cancel_refund";
}
```

Then add the cancellation button to the BountyDetailScreen:
```tsx name=app/bounty/[id].tsx
// ...existing imports...
import { cancelBounty } from "../../lib/services/bountyService";

// ...existing component code...
{bounty.user_id === currentUser.id && bounty.status === "open" && (
  <TouchableOpacity 
    className="bg-red-500 px-4 py-2 rounded-lg mt-4"
    onPress={async () => {
      try {
        await cancelBounty(bounty.id);
        // Show success message
        Toast.show("Bounty cancelled successfully");
        navigation.goBack();
      } catch (error) {
        // Show error
        Toast.show("Failed to cancel bounty");
      }
    }}
  >
    <Text className="text-white font-medium">Cancel Bounty</Text>
  </TouchableOpacity>
)}
```
```

**Example 2: Recognizing Implied Requirements**

User request: "Create a component to display a user's reputation"

Poor response:
```tsx
// Here's a component:
const UserReputation = ({ score }) => (
  <Text>Reputation: {score}/5</Text>
);
```

Good response:
```
A reputation component in BOUNTYExpo needs to consider several implicit requirements:

1. Trust is central to the platform, so reputation is critical for both hunters and posters
2. Reputation likely comes from completed bounties and ratings
3. The component needs to be usable in multiple contexts (profiles, bounty listings, chat)
4. Mobile-first design principles apply

Here's an implementation that accounts for these contexts:

```tsx name=components/UserReputation.tsx
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { StarIcon } from './Icons';
import { useUserStats } from '../hooks/useUserStats';

type ReputationSize = 'small' | 'medium' | 'large';

interface UserReputationProps {
  userId: string;
  size?: ReputationSize;
  showCount?: boolean; // Whether to show the count of ratings
  onPress?: () => void; // For opening detailed reputation view
}

export const UserReputation: React.FC<UserReputationProps> = ({
  userId,
  size = 'medium',
  showCount = false,
  onPress,
}) => {
  const { reputation, isLoading, error, ratingCount } = useUserStats(userId);
  
  if (isLoading) {
    return <View className="animate-pulse bg-gray-200 rounded h-4 w-20" />;
  }
  
  if (error || reputation === undefined) {
    return <Text className="text-gray-400 italic">No reputation yet</Text>;
  }

  const Component = onPress ? TouchableOpacity : View;
  
  const sizeClassMap: Record<ReputationSize, string> = {
    small: 'h-3 w-3',
    medium: 'h-4 w-4',
    large: 'h-5 w-5',
  };
  
  const starClass = sizeClassMap[size];
  
  // Calculate filled and partial stars
  const filledStars = Math.floor(reputation);
  const hasPartialStar = reputation % 1 > 0;
  
  return (
    <Component 
      className="flex flex-row items-center" 
      onPress={onPress}
      accessible={!!onPress}
      accessibilityLabel={`User reputation ${reputation} out of 5 stars${showCount ? `, ${ratingCount} ratings` : ''}`}
    >
      <View className="flex flex-row">
        {[...Array(5)].map((_, i) => (
          <StarIcon
            key={i}
            className={`${starClass} ${i < filledStars ? 'text-yellow-500' : 'text-gray-300'}`}
            filled={i < filledStars}
            partial={i === filledStars && hasPartialStar}
          />
        ))}
      </View>
      
      {showCount && (
        <Text className="ml-2 text-gray-500 text-sm">
          ({ratingCount})
        </Text>
      )}
    </Component>
  );
};

// Usage examples:
// <UserReputation userId="123" /> - Default medium size
// <UserReputation userId="123" size="small" /> - Small stars for compact display
// <UserReputation userId="123" showCount={true} onPress={() => navigate('ReputationDetail', { id: '123' })} />
```

This component:
1. Handles loading and error states
2. Adapts to different display sizes for different contexts
3. Includes accessibility labels
4. Shows optional rating count
5. Supports navigation to detailed view
6. Follows the project's styling patterns
```

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
- Short term: Polish posting flow, chat stability, wallet mock
- Medium term: Expand reputation system, location-based features
- Long term: Advanced payment options, recurring bounties

## Multi-Layered Information Processing
When working with complex requests, process information in these layers:

1. **Technical requirements**: What code/components need changing?
2. **Functional requirements**: What user problems is this solving?
3. **Architectural implications**: How does this affect the system design?
4. **Cross-cutting concerns**: What about error handling, performance, accessibility?
5. **Future compatibility**: Will this align with the roadmap?

Present solutions that address all relevant layers, not just the technical implementation.