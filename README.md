# BOUNTY

> Mobile-first micro‑bounty marketplace. Create → Match → Chat → Complete → Settle. Fast, transparent, escrow‑backed.

## 🚀 Elevator Pitch
BOUNTYExpo makes it **fast and safe** to post small jobs ("bounties"), get matched with a hunter, coordinate in-app, and settle payment via an escrow flow. Designed for trust, speed, and clarity.

## 🌱 Status
Early development / scaffolding. Core navigation + initial domain modeling in progress. Short-term focus: posting flow polish, chat stability, wallet (mock) interactions.

## 📱 Core User Flows (Happy Paths)
1. Create Bounty: Poster enters title, description, amount (or marks as honor), optional location → bounty appears in Postings feed.
2. Accept & Coordinate: Hunter opens a Posting → applies/accepts → Conversation auto-initiated.
3. Complete & Settle: Escrow funded on accept → completion triggers release → both parties see history.
4. Schedule (Lightweight): Optional due date shows in a read-only Calendar summary.

## 🧠 Domain Glossary
| Term | Meaning |
|------|---------|
| Bounty | A task with title, description, amount or isForHonor flag, optional location. |
| Posting | A bounty in the public feed (status = open). |
| Request | A proposal/acceptance record on a bounty (future extension). |
| Conversation | 1:1 or group chat, optionally tied to a bounty. |
| Wallet | Escrow + transaction records (mock for now). |
| Calendar | Date summarization layer (read-only initially). |

## 📦 Authoritative Types (Source of Truth)
```ts
// lib/types.ts
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
(Do **not** redefine these elsewhere—import from `lib/types`.)

## 🗺️ Navigation Architecture
The app uses **Expo Router** with file-based routing. A single root shell component (e.g. `BountyApp`) renders the **BottomNav** once. Screens must NOT duplicate navigation state.

Bottom navigation mapping:
- create → Messenger (entry point to conversations / future create funnel enhancements)
- wallet → WalletScreen
- bounty → Dashboard / Home summary view
- postings → PostingsScreen (public feed)
- calendar → Calendar summary

Layout rules:
- Root container: `position: relative; flex: 1;` plus `paddingBottom` to clear nav height.
- BottomNav: `position: absolute; left:0; right:0; bottom:0; zIndex` high.
- If nav height changes, increase root `paddingBottom` accordingly.

## 🎨 UI / UX Principles
- Mobile-first, emerald palette (emerald-600/700/800) for primary actions.
- Clear primary CTA: central bounty action in nav.
- Favor helpful empty states over spinners (action-oriented copy + 1 primary button).
- Respect safe areas; no content hidden behind nav.

## ⚡ Performance & Optimization
### Images
- **Always use `OptimizedImage`** from `lib/components/OptimizedImage` for better caching and memory management
- For list items: specify `width` and `height` to enable thumbnail optimization
- For detail views: set `useThumbnail={false}` for full resolution
- Leverages `expo-image` for automatic memory-disk caching

### Lists
- **Use FlatList, not ScrollView with .map()** for any list with >10 items
- Extract `renderItem` and `keyExtractor` to `useCallback` to avoid recreating functions
- Add performance props: `removeClippedSubviews`, `maxToRenderPerBatch`, `windowSize`, `initialNumToRender`
- Example:
  ```tsx
  const renderItem = useCallback(({ item }) => <ItemComponent {...item} />, [deps]);
  const keyExtractor = useCallback((item) => item.id, []);
  
  <FlatList
    data={items}
    renderItem={renderItem}
    keyExtractor={keyExtractor}
    removeClippedSubviews={true}
    maxToRenderPerBatch={10}
    windowSize={5}
  />
  ```

### Monitoring
- See `PERFORMANCE.md` for comprehensive performance audit checklist
- Run `npm run audit-deps` monthly to check dependencies

## 🧩 State & Data Practices
- Lift navigation state to root only. Pass via props: `<BottomNav activeScreen={activeScreen} onNavigate={setActiveScreen} />`.
- Avoid shadow local `activeScreen` states.
- Async data: custom hooks in `hooks/`; remote/services in `lib/services/`.
- Memoize heavy list items / chat nodes with `React.memo`, `useCallback`, `useMemo`.

## 🛡️ Error & Empty Strategy
- Non-blocking: On fetch failure, render fallback UI + Retry instead of blank screen.
- Inline error banners with dismiss `✕`.
- Cache-first (future enhancement) to allow degraded offline view.

## ⚙️ Development
### Prereqs
- Node 18+
- Expo CLI (installed transiently via `npx`)

### Install
```bash
npm install
```

### Start
```bash
npx expo start
```
Use a device, emulator, or Expo Go. For weird bundler issues:
```bash
npx expo start --clear
```

### Type Check (required before PR)
```bash
npx tsc --noEmit
```

### Project Reset (from the original template)
```bash
npm run reset-project
```
(Not typically needed now that base scaffolding is customized.)

## 📁 Suggested Structure (Illustrative)
```
app/
  (routes...)
components/
  BottomNav.tsx
hooks/
  useBounties.ts
lib/
  types.ts
  services/
    bountyService.ts
```
(Actual structure may evolve; keep types centralized.)

## 🔐 Future: Escrow & Wallet
Initial phase: mock transactions for UI. Future integration targets: Stripe Connect / Replit Deploy / TBD custody service. Design assumptions:
- Escrow created at acceptance.
- Release only by Poster confirmation or dual-sign event.
- Refund path for timeouts / disputes (manual early phase).

## 🧪 Testing (Planned)
- Unit: domain helpers & formatting.
- Integration: navigation flows (Detox / Maestro candidate).
- Snapshot: stable UI components (BottomNav, PostingCard, ChatBubble).

## 🧭 Roadmap (Signal)
Short Term:
- Postings creation polish
- Conversation stability & message persistence layer
- Mock wallet flows (escrow → release)
- Calendar summary pass

Mid Term:
- Real escrow provider integration
- Request lifecycle (apply / accept handshake)
- Push notifications for chat + status changes
- Offline optimistic message queue

Long Term:
- Reputation / profile proofs
- Dispute mediation tooling
- Multi-currency support

## 🤝 Contributing
1. Fork & branch: `feat/<slug>`
2. Keep commits scoped & conventional style (e.g. `feat: add bounty list filtering`).
3. Run `npx tsc --noEmit` before pushing.
4. Open PR with: problem summary, screenshots (if UI), and testing notes.

## 🧩 AI Collaboration Guidelines
When using AI assistance:
- Provide patch-style suggestions with clear filepath headers.
- Do NOT add duplicate navigation components.
- Always import `StyleSheet` as a value from `react-native` (never as a type-only import).
- Ensure all JSX tags are properly closed.

## 🗣️ Communication Guidelines
- Prefer async updates in PR descriptions vs. large speculative refactors.
- Document new domain fields directly in `lib/types.ts` first.

## 📜 License
(Choose a license—currently unspecified. Consider MIT for openness.)

## 🙌 Acknowledgements
Built with Expo + React Native. Inspired by lightweight, trust-centered gig flows.

---
Questions / ideas? Open a discussion or start a PR.
