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

## 🧩 State & Data Practices
- Lift navigation state to root only. Pass via props: `<BottomNav activeScreen={activeScreen} onNavigate={setActiveScreen} />`.
- Avoid shadow local `activeScreen` states.
- Async data: custom hooks in `hooks/`; remote/services in `lib/services/`.
- Memoize heavy list items / chat nodes with `React.memo`, `useCallback`, `useMemo`.

## 🛡️ Error & Empty Strategy
- Non-blocking: On fetch failure, render fallback UI + Retry instead of blank screen.
- Inline error banners with dismiss `✕`.
- Cache-first (future enhancement) to allow degraded offline view.

## 🚀 First Run

### Prerequisites
- **Node.js 18+** - Download from [nodejs.org](https://nodejs.org/)
- **Docker & Docker Compose** - For running PostgreSQL and Stripe Mock locally
- **pnpm** - Fast package manager (auto-installed if missing)
- **Expo CLI** - For mobile development (installed on-demand)

### Quick Start (Recommended)

#### Option 1: Automated Setup Script
```bash
# Clone the repository
git clone https://github.com/kodaksax/bountyexpo.git
cd bountyexpo

# Run the automated setup script
./scripts/setup.sh

# Start all services with one command
pnpm dev

# In another terminal, start the Expo development server
pnpm start
```

#### Option 2: Manual Setup

1. **Clone and Install Dependencies**
```bash
git clone https://github.com/kodaksax/bountyexpo.git
cd bountyexpo
pnpm install
```

2. **Configure Environment**
```bash
# Copy environment template
cp .env.example .env

# Edit .env with your configuration (see Environment Variables section below)
# For local development, the defaults work out of the box!
```

3. **Start Development Stack**
```bash
# Start infrastructure services (PostgreSQL + Stripe Mock)
pnpm dev

# In a new terminal, start the API server  
pnpm dev:api

# This will:
# ✅ Start PostgreSQL database on port 5432
# ✅ Start Stripe Mock server on port 12111
# ✅ Start BountyExpo API server on port 3001
# ✅ Automatically run database migrations
```

4. **Start Mobile App**
```bash
# In a new terminal window
pnpm start

# Follow Expo CLI instructions to:
# - Scan QR code with Expo Go app (iOS/Android)
# - Press 'i' for iOS Simulator
# - Press 'a' for Android Emulator
# - Press 'w' for web browser
```

### Environment Variables

Your `.env` file should contain these essential variables:

```bash
# Database (automatically configured for local Docker setup)
DATABASE_URL="postgresql://bountyexpo:bountyexpo123@localhost:5432/bountyexpo"

# Stripe (use test keys for development)
STRIPE_SECRET_KEY="sk_test_your_key_here"
EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY="pk_test_your_key_here"

# Supabase (for authentication - REQUIRED)
# Get these from your Supabase project settings:
# 1. Go to https://supabase.com/dashboard
# 2. Select your project > Settings > API
SUPABASE_URL="https://your-project.supabase.co"
EXPO_PUBLIC_SUPABASE_URL="https://your-project.supabase.co"
SUPABASE_ANON_KEY="your-anon-key"
EXPO_PUBLIC_SUPABASE_ANON_KEY="your-anon-key"
SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"  # Keep secret, server-side only!
SUPABASE_JWT_SECRET="your-jwt-secret"

# API Configuration
API_BASE_URL="http://localhost:3001"
EXPO_PUBLIC_API_URL="http://localhost:3001"
```

### Service Status & URLs

After running `pnpm dev`, these services will be available:

| Service | URL | Description |
|---------|-----|-------------|
| **API Server** | http://localhost:3001 | Main BountyExpo API |
| **PostgreSQL** | localhost:5432 | Database server |
| **Stripe Mock** | http://localhost:12111 | Mock payment processing |
| **API Health** | http://localhost:3001/health | Health check endpoint |

### Stripe Payment Server

A minimal Express server (`server/`) handles Stripe payment operations:

**Features:**
- Payment Intent creation for wallet deposits
- Webhook handling with signature verification
- Stripe Connect scaffolds for withdrawals
- Local transaction logging (demo mode)

**Quick Start:**
```bash
# Navigate to server directory
cd server

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your Stripe keys

# Start the server
npm start
```

**Endpoints:**
- `GET /health` - Health check
- `POST /payments/create-payment-intent` - Create payment intent
- `POST /webhooks/stripe` - Handle Stripe webhooks
- `POST /connect/create-account-link` - Stripe Connect onboarding
- `POST /connect/transfer` - Initiate bank transfers

**Configuration:**
Set these in `server/.env`:
```bash
STRIPE_SECRET_KEY=sk_test_your_key_here
STRIPE_WEBHOOK_SECRET=whsec_your_secret_here
PORT=3001
```

📖 **Full documentation:** See [STRIPE_INTEGRATION_BACKEND.md](./STRIPE_INTEGRATION_BACKEND.md)

### Useful Commands

```bash
# Development
pnpm dev          # Start infrastructure services (PostgreSQL + Stripe Mock)
pnpm dev:api      # Start API server (run in separate terminal)
pnpm start        # Start Expo development server
pnpm dev:stop     # Stop all services
pnpm dev:logs     # View service logs

# Testing
pnpm test:auth    # Test authentication endpoints (sign-up/sign-in)
pnpm test:api     # Test API endpoints

# Database
pnpm db:init      # Initialize database (if needed)
pnpm --filter @bountyexpo/api db:migrate  # Run migrations
pnpm --filter @bountyexpo/api db:seed     # Seed with sample data

# Code Quality
pnpm type-check   # TypeScript checks across all packages
pnpm lint         # Lint code
```

### Migration Instructions

If you're updating from an older version:

1. **Update Dependencies**
```bash
pnpm install
```

2. **Update Environment File**
```bash
# Compare your .env with the new .env.example
# Add any missing variables
```

3. **Database Migrations**
```bash
# Stop existing services
pnpm dev:stop

# Start fresh with latest schema
pnpm dev

# The database will auto-migrate on startup
```

4. **Clear Metro Cache** (if experiencing issues)
```bash
pnpm start --clear
```

### Authentication Setup (Supabase)

BountyExpo uses **Supabase** for authentication. To set it up:

1. **Create a Supabase Project**
   - Go to [supabase.com](https://supabase.com)
   - Create a new project
   - Wait for database to be provisioned

2. **Get API Credentials**
   - Navigate to Settings > API in your Supabase dashboard
   - Copy the Project URL and API keys
   - Update your `.env` file with these values

3. **Test Authentication**
   ```bash
   # Make sure API server is running
   pnpm dev:api
   
   # Run auth tests
   pnpm test:auth
   ```
   
   You should see:
   - ✅ Health check passed
   - ✅ Supabase configuration valid
   - ✅ Sign-up successful
   - ✅ Sign-in successful

4. **Troubleshooting Auth Issues**
   - Check `.env` has all required Supabase variables
   - Verify `SUPABASE_SERVICE_ROLE_KEY` (not ANON_KEY) is set for server
   - Ensure both server and client keys are configured
   - Check Supabase dashboard for user creation logs

5. **API Client Package**

The `@bountyexpo/api-client` package provides typed API wrappers and React hooks:

```bash
# Build all packages
npm run build

# Type check everything
npm run type-check
```

5. **Access the Application**
- **Frontend**: Expo Dev Tools will open in your browser
- **Backend API**: Available at `http://localhost:3001`
- **Database**: Migrations run automatically on API startup

### Troubleshooting

- **Database Connection Issues**: Ensure PostgreSQL is running and DATABASE_URL is correct
- **Build Errors**: Run `npm run type-check` to identify TypeScript issues
- **Metro Bundler Issues**: Clear cache with `npx expo start --clear`

## ⚙️ Development

### Architecture
BountyExpo uses a modern, scalable monorepo architecture:

- **Frontend**: React Native + Expo app (main directory)
- **Backend API**: Fastify + Drizzle ORM + PostgreSQL (`services/api/`)
- **Shared Types**: Cross-platform type definitions (`packages/domain-types/`)
- **Docker Environment**: Containerized PostgreSQL + Stripe Mock for consistent development

### Development Stack
- **Mobile**: React Native 0.81+ with Expo 54+
- **Backend**: Node.js + Fastify + TypeScript
- **Database**: PostgreSQL 15 with Drizzle ORM
- **Payments**: Stripe integration with local mock server
- **Authentication**: Supabase JWT with automatic user provisioning
- **Package Management**: pnpm with workspace configuration

### Quick Development Commands

```bash
# Start everything (recommended)
pnpm dev             # Infrastructure: PostgreSQL + Stripe Mock  
pnpm dev:api         # API server (separate terminal)
pnpm start           # Expo development server (separate terminal)

# Individual services
pnpm dev:api        # API server only
pnpm dev:stop       # Stop all Docker services
pnpm dev:logs       # View service logs

# Code quality
pnpm type-check     # TypeScript validation across all packages
pnpm lint           # ESLint checks
```

### Development Workflow

1. **Start Services**: `pnpm dev` (runs PostgreSQL, API, Stripe Mock)
2. **Start Mobile App**: `pnpm start` (in separate terminal)
3. **Make Changes**: Edit code with hot reloading
4. **Check Types**: `pnpm type-check` before committing
5. **View Logs**: `pnpm dev:logs` for debugging

### Backend API Features
- **Auto-Migration**: Database schema updates automatically
- **JWT Authentication**: Secure endpoints with Supabase integration  
- **Type Safety**: End-to-end TypeScript with Drizzle ORM
- **Real-time Events**: WebSocket support for live updates
- **Stripe Integration**: Payment processing with local mock server

### Database Management
```bash
# Direct database access (when services are running)
psql postgresql://bountyexpo:bountyexpo123@localhost:5432/bountyexpo

# API-specific database commands
pnpm --filter @bountyexpo/api db:migrate    # Run migrations
pnpm --filter @bountyexpo/api db:seed       # Add sample data  
pnpm --filter @bountyexpo/api db:studio     # Drizzle Studio UI
```

See `services/api/README.md` for detailed API documentation.

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

## 📡 Realtime Events

The API supports realtime bounty status updates via WebSocket or Supabase Realtime.

### Subscribing to Events

**WebSocket Connection:**
```javascript
const ws = new WebSocket('ws://localhost:3001/events/subscribe');

ws.on('message', (data) => {
  const event = JSON.parse(data);
  console.log('Realtime event:', event);
});
```

**Event Payload Format:**
```json
{
  "type": "bounty.status",
  "id": "bounty-id-123",
  "status": "in_progress",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

**Status Values:**
- `open` - Bounty is available for acceptance
- `in_progress` - Bounty has been accepted and is being worked on
- `completed` - Bounty work has been completed
- `archived` - Bounty has been archived/cancelled

**Endpoint Documentation:**
- GET `/events/subscribe-info` - WebSocket connection instructions
- GET `/events/stats` - Current connection statistics
- WebSocket `/events/subscribe` - Realtime event stream

### Triggers

Realtime events are published when:
- A bounty is accepted (`open` → `in_progress`)
- A bounty is completed (`in_progress` → `completed`)

Mid Term:
- Real escrow provider integration
- Request lifecycle (apply / accept handshake)
- Push notifications for chat + status changes
- Offline optimistic message queue

Long Term:
- Reputation / profile proofs
- Dispute mediation tooling
- Multi-currency support

## 🔧 Troubleshooting

### Common Issues

**"Docker not found" or service won't start**
```bash
# Ensure Docker is running
docker --version
docker-compose --version

# Check if ports are available
lsof -i :5432  # PostgreSQL
lsof -i :3001  # API server
```

**"Database connection failed"**
```bash
# Check if PostgreSQL container is running
docker ps

# Restart database service
pnpm dev:stop
pnpm dev

# Check database logs
docker logs bountyexpo-postgres
```

**"Expo build fails" or Metro bundler issues**
```bash
# Clear Metro cache
pnpm start --clear

# Clean node_modules and reinstall
rm -rf node_modules
pnpm install
```

**"TypeScript errors in IDE"**
```bash
# Run type checking manually
pnpm type-check

# Restart TypeScript language server in your IDE
# VS Code: Cmd/Ctrl + Shift + P → "TypeScript: Restart TS Server"
```

**"API endpoints return 401/403 errors"**
- Check your `.env` file has correct Supabase credentials
- Verify JWT tokens are being sent from the mobile app
- Check API server logs: `pnpm dev:logs`

**"Stripe payments not working"**
- Ensure you're using test keys (start with `sk_test_` and `pk_test_`)
- Verify Stripe Mock server is running on port 12111
- Check the console for payment-related errors

### Getting Help

1. **Check the logs**: `pnpm dev:logs` shows all service logs
2. **Verify services**: All services should show as "UP" in `docker ps`
3. **Health check**: Visit http://localhost:3001/health
4. **Reset everything**: `pnpm dev:stop` then `pnpm dev`
5. **Open an issue**: If problems persist, create a GitHub issue with:
   - Your OS and Node.js version
   - Complete error messages
   - Steps to reproduce

## 🤝 Contributing

### Getting Started
1. **Fork & Clone**: Fork the repo and create a feature branch
```bash
git checkout -b feat/your-feature-name
```

2. **Set up Development Environment**: 
```bash
./scripts/setup.sh  # Automated setup
# OR follow the "First Run" section above
```

3. **Make Your Changes**: Edit code with hot reloading enabled

4. **Test Your Changes**:
```bash
pnpm type-check     # TypeScript validation
pnpm lint           # Code style checks
pnpm dev:logs       # Check for errors in services
```

5. **Commit & Push**:
```bash
git add .
git commit -m "feat: add your feature description"
git push origin feat/your-feature-name
```

6. **Open Pull Request**: Include:
   - **Problem Summary**: What issue does this solve?
   - **Screenshots**: For UI changes
   - **Testing Notes**: How to verify the changes work
   - **Breaking Changes**: Any API or schema changes

### Development Guidelines
- **Commit Style**: Use conventional commits (`feat:`, `fix:`, `docs:`, etc.)
- **TypeScript**: All code must pass `pnpm type-check`
- **Code Style**: Follow existing patterns, use provided linting
- **Testing**: Test your changes locally with `pnpm dev` + `pnpm start`
- **Documentation**: Update README.md for significant changes

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
