# BountyExpo Quick Start Guide

> Get BountyExpo up and running in under 10 minutes

## Prerequisites Checklist

Before you begin, make sure you have:

- [ ] **Node.js 18+** installed ([download](https://nodejs.org/))
- [ ] **pnpm** package manager (`npm install -g pnpm`)
- [ ] **Docker Desktop** installed and running
- [ ] **Supabase account** ([sign up](https://supabase.com))
- [ ] **Stripe account** for payments ([sign up](https://stripe.com))
- [ ] **Expo account** for mobile builds ([sign up](https://expo.dev))
- [ ] **Git** for version control

## 5-Minute Setup

### Step 1: Clone and Install (2 minutes)

```bash
# Clone the repository
git clone https://github.com/kodaksax/Bounty-production.git
cd Bounty-production

# Install all dependencies
pnpm install
```

### Step 2: Configure Environment (2 minutes)

```bash
# Copy environment template
cp .env.example .env
```

Edit `.env` with your credentials:

```bash
# Supabase (REQUIRED - get from https://supabase.com/dashboard)
SUPABASE_URL="https://xxxxx.supabase.co"
EXPO_PUBLIC_SUPABASE_URL="https://xxxxx.supabase.co"
SUPABASE_ANON_KEY="your-anon-key"
EXPO_PUBLIC_SUPABASE_ANON_KEY="your-anon-key"
SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
SUPABASE_JWT_SECRET="your-jwt-secret"

# Stripe (Use test keys for development)
STRIPE_SECRET_KEY="sk_test_xxxxx"
EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY="pk_test_xxxxx"

# Database (defaults work for local Docker)
DATABASE_URL="postgresql://bountyexpo:bountyexpo123@localhost:5432/bountyexpo"

# API
API_BASE_URL="http://localhost:3001"
EXPO_PUBLIC_API_URL="http://localhost:3001"
```

### Step 3: Start Services (1 minute)

```bash
# Terminal 1: Start infrastructure (PostgreSQL, Redis, Stripe Mock)
pnpm dev

# Terminal 2: Start API server
pnpm dev:api

# Terminal 3: Start mobile app
pnpm start
```

✅ **You're now running BountyExpo!**

- API: http://localhost:3001
- Health check: http://localhost:3001/health
- Mobile app: Scan QR code with Expo Go app

---

## What Just Happened?

### Services Started

1. **PostgreSQL** (port 5432) - Database
2. **Redis** (port 6379) - Cache
3. **Stripe Mock** (port 12111) - Payment simulation
4. **API Server** (port 3001) - Backend API
5. **Expo Dev Server** (port 8081) - Mobile app

### Database Setup

The API automatically:
- ✅ Connects to PostgreSQL
- ✅ Runs database migrations
- ✅ Creates required tables
- ✅ Sets up indexes

---

## Testing the Setup

### 1. Check API Health

```bash
curl http://localhost:3001/health
```

**Expected response:**
```json
{
  "status": "healthy",
  "timestamp": "2024-01-07T12:00:00Z",
  "services": {
    "database": "healthy",
    "redis": "healthy",
    "supabase": "healthy"
  }
}
```

### 2. Test Authentication

```bash
# Sign up a test user
curl -X POST http://localhost:3001/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "TestPass123!",
    "username": "testuser"
  }'
```

### 3. Open Mobile App

1. **On iOS**: Scan QR code with Camera app → Opens in Expo Go
2. **On Android**: Scan QR code with Expo Go app
3. **Press 'i'**: Opens iOS Simulator (Mac only)
4. **Press 'a'**: Opens Android Emulator
5. **Press 'w'**: Opens in web browser

---

## Common Development Tasks

### View Database

```bash
# Open Drizzle Studio (database GUI)
cd services/api
pnpm db:studio
# Opens at http://localhost:4983
```

### Clear Metro Cache

```bash
# If you see stale code or layout issues
pnpm start --clear
```

### Reset Database

```bash
# Stop services
pnpm dev:stop

# Remove database volume
docker volume rm bountyexpo_postgres_data

# Restart services (will recreate database)
pnpm dev
pnpm dev:api
```

### View Logs

```bash
# View all service logs
pnpm dev:logs

# View API logs only
cd services/api
pnpm dev  # Logs visible in terminal

# View Docker logs
docker logs bountyexpo-postgres
docker logs bountyexpo-redis
```

---

## Troubleshooting

### "Port 5432 already in use"

Another PostgreSQL instance is running.

**Solution:**
```bash
# Stop other PostgreSQL
brew services stop postgresql  # Mac
sudo service postgresql stop   # Linux

# Or change port in docker-compose.yml
```

### "Cannot connect to database"

Database container not running or wrong credentials.

**Solution:**
```bash
# Check if container is running
docker ps | grep postgres

# Restart services
pnpm dev:stop
pnpm dev

# Verify DATABASE_URL in .env matches docker-compose.yml
```

### "Supabase auth errors"

Missing or invalid Supabase credentials.

**Solution:**
1. Go to https://supabase.com/dashboard
2. Select your project
3. Settings → API
4. Copy all keys to `.env`
5. Restart API server

### "Stripe payments failing"

Using wrong Stripe keys or webhook secret.

**Solution:**
```bash
# For development, use test keys (sk_test_* and pk_test_*)
# Get from https://dashboard.stripe.com/test/apikeys

# For local webhooks, use Stripe CLI
stripe listen --forward-to localhost:3001/webhooks/stripe
# Copy webhook secret (whsec_*) to .env
```

### "Expo Go shows 'Unable to connect'"

API URL incorrect or API not running.

**Solution:**
1. Verify API is running: `curl http://localhost:3001/health`
2. If using physical device, use your machine's IP:
   ```bash
   # Find your local IP
   ipconfig getifaddr en0  # Mac
   ip addr show            # Linux
   ipconfig               # Windows
   
   # Update .env
   EXPO_PUBLIC_API_URL="http://192.168.1.x:3001"
   
   # Restart Expo with cache clear
   pnpm start --clear
   ```

### "Module not found" errors

Dependencies not installed or cache issue.

**Solution:**
```bash
# Clean install
rm -rf node_modules
pnpm install

# Clear Metro cache
pnpm start --clear

# Clear watchman (if on Mac)
watchman watch-del-all
```

---

## Next Steps

Now that you're set up, here's what to explore:

### 1. Create a Bounty

```bash
# In mobile app:
1. Sign up / Sign in
2. Tap "Postings" tab
3. Tap "+" button
4. Fill in bounty details
5. Tap "Create Bounty"
```

### 2. Test the API

```bash
# Get auth token from sign-in response
TOKEN="your-jwt-token"

# Create a bounty via API
curl -X POST http://localhost:3001/bounties \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Build a landing page for my startup",
    "description": "Need a professional, responsive landing page with modern design...",
    "amount": 50000,
    "isForHonor": false,
    "location": "Remote"
  }'
```

### 3. Explore the Codebase

```
app/               # Mobile app screens (Expo Router)
components/        # Reusable UI components
lib/
  ├── types.ts     # Type definitions (source of truth)
  ├── services/    # Business logic
  └── utils/       # Utilities
services/api/      # Backend API
  ├── src/routes/  # API endpoints
  └── src/db/      # Database schema
```

### 4. Read the Docs

- [API Reference](./API_REFERENCE.md) - Complete API documentation
- [Architecture](./ARCHITECTURE.md) - System design and architecture
- [Contributing](./CONTRIBUTING.md) - Development guidelines
- [Deployment](./DEPLOYMENT.md) - Production deployment guide

---

## Development Workflow

### Daily Development

```bash
# Morning
pnpm dev          # Start infrastructure
pnpm dev:api      # Start API (new terminal)
pnpm start        # Start mobile app (new terminal)

# Make changes...
# Hot reload applies automatically

# Before committing
pnpm type-check   # Check TypeScript
pnpm lint         # Check code style

# Evening
pnpm dev:stop     # Stop all services
```

### Making Changes

1. **Create feature branch**
   ```bash
   git checkout -b feature/your-feature
   ```

2. **Make changes**
   - Edit code with hot reload
   - Test in mobile app
   - Check API responses

3. **Test changes**
   ```bash
   pnpm type-check
   pnpm test
   ```

4. **Commit and push**
   ```bash
   git add .
   git commit -m "feat: your feature description"
   git push origin feature/your-feature
   ```

5. **Create pull request**
   - Go to GitHub
   - Create PR from your branch
   - Fill in PR template

---

## Resource Usage

### Typical Resource Consumption

| Service | CPU | Memory | Disk |
|---------|-----|--------|------|
| PostgreSQL | 5-10% | 200MB | 500MB |
| Redis | 2-5% | 50MB | 100MB |
| API Server | 5-15% | 150MB | - |
| Metro Bundler | 10-20% | 300MB | - |

**Total**: ~700MB RAM, ~600MB disk

---

## Learning Resources

### For Backend Development

- [Fastify Documentation](https://www.fastify.io/)
- [Drizzle ORM Guide](https://orm.drizzle.team/docs/overview)
- [Supabase Auth](https://supabase.com/docs/guides/auth)

### For Mobile Development

- [Expo Documentation](https://docs.expo.dev/)
- [React Native Guide](https://reactnative.dev/docs/getting-started)
- [Expo Router](https://docs.expo.dev/router/introduction/)

### For Payments

- [Stripe API Reference](https://stripe.com/docs/api)
- [Stripe Testing](https://stripe.com/docs/testing)

---

## Getting Help

### In-App Help

- Check the logs: `pnpm dev:logs`
- View health status: http://localhost:3001/health
- Open database GUI: `pnpm db:studio`

### Documentation

- [README.md](./README.md) - Project overview
- [API_REFERENCE.md](./API_REFERENCE.md) - API endpoints
- [ARCHITECTURE.md](./ARCHITECTURE.md) - System architecture
- [CONTRIBUTING.md](./CONTRIBUTING.md) - Development guide
- [DEPLOYMENT.md](./DEPLOYMENT.md) - Production deployment

### Community

- **GitHub Issues**: Report bugs or request features
- **GitHub Discussions**: Ask questions and share ideas
- **Email**: dev@bountyexpo.com

---

## Success Checklist

You're ready to develop when you can:

- [ ] Access API health endpoint (http://localhost:3001/health)
- [ ] Sign up a user via mobile app
- [ ] Create a test bounty
- [ ] Send a test message
- [ ] View database in Drizzle Studio
- [ ] Run `pnpm type-check` without errors
- [ ] See live reload when editing code

**✅ If all checked, you're good to go!**

---

**Happy coding! 🎉**

Need help? Check [CONTRIBUTING.md](./CONTRIBUTING.md) or open an issue.
