# Stripe Backend Integration - Visual Guide

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         BountyExpo App                           │
│                      (React Native / Expo)                       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ HTTP/HTTPS
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Express Payment Server                        │
│                      (Node.js / Port 3001)                       │
│                                                                   │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐   │
│  │   /health      │  │  /payments/    │  │  /webhooks/    │   │
│  │                │  │  create-       │  │  stripe        │   │
│  │  Health Check  │  │  payment-      │  │                │   │
│  │                │  │  intent        │  │  Event Handler │   │
│  └────────────────┘  └────────────────┘  └────────────────┘   │
│                                                                   │
│  ┌────────────────┐  ┌────────────────┐                        │
│  │  /connect/     │  │  /connect/     │                        │
│  │  create-       │  │  transfer      │                        │
│  │  account-link  │  │                │                        │
│  │                │  │  Bank Transfer │                        │
│  │  Connect       │  │  (Scaffold)    │                        │
│  │  Onboarding    │  │                │                        │
│  └────────────────┘  └────────────────┘                        │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │          wallet-transactions.json (Demo Storage)        │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Stripe API
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         Stripe Services                          │
│                                                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │  PaymentIntent│  │  Webhooks    │  │  Connect     │         │
│  │  API          │  │  Events      │  │  API         │         │
│  └──────────────┘  └──────────────┘  └──────────────┘         │
└─────────────────────────────────────────────────────────────────┘
```

## Payment Flow: Adding Money

```
┌─────────────┐                                               
│   User      │                                               
│   Opens     │                                               
│   Add Money │                                               
└──────┬──────┘                                               
       │                                                      
       │ 1. Enter amount ($50.00)                           
       ▼                                                      
┌─────────────┐                                               
│ Add Money   │                                               
│ Screen      │                                               
└──────┬──────┘                                               
       │                                                      
       │ 2. Click "Add Money"                               
       ▼                                                      
┌─────────────┐                                               
│ Frontend    │                                               
│ Validation  │  Check payment methods exist                 
└──────┬──────┘  Convert to cents (5000)                    
       │                                                      
       │ 3. POST /payments/create-payment-intent            
       │    { amountCents: 5000, currency: 'usd' }          
       ▼                                                      
┌─────────────┐                                               
│  Backend    │                                               
│  Express    │  Validate input                              
│  Server     │  Call Stripe API                             
└──────┬──────┘                                               
       │                                                      
       │ 4. Create PaymentIntent                            
       ▼                                                      
┌─────────────┐                                               
│   Stripe    │                                               
│   API       │  Generate clientSecret                       
└──────┬──────┘                                               
       │                                                      
       │ 5. Return { clientSecret, paymentIntentId }        
       ▼                                                      
┌─────────────┐                                               
│  Backend    │                                               
│  Response   │  Send to frontend                            
└──────┬──────┘                                               
       │                                                      
       │ 6. Confirm payment with Stripe SDK                 
       ▼                                                      
┌─────────────┐                                               
│  Stripe     │                                               
│  Process    │  Charge payment method                       
└──────┬──────┘                                               
       │                                                      
       │ 7. Send webhook: payment_intent.succeeded          
       ▼                                                      
┌─────────────┐                                               
│  Backend    │                                               
│  Webhook    │  Verify signature                            
│  Handler    │  Log transaction                             
└──────┬──────┘                                               
       │                                                      
       │ 8. Update wallet balance                           
       ▼                                                      
┌─────────────┐                                               
│   User      │                                               
│   Sees      │  Success! $50 added                          
│   Balance   │                                               
└─────────────┘                                               
```

## Withdrawal Flow: Stripe Connect

```
┌─────────────┐                                               
│   User      │                                               
│   Opens     │                                               
│   Withdraw  │                                               
└──────┬──────┘                                               
       │                                                      
       │ 1. First time: No bank account                     
       ▼                                                      
┌─────────────┐                                               
│ Withdraw    │                                               
│ Screen      │  "Connect Bank Account" button               
└──────┬──────┘                                               
       │                                                      
       │ 2. Click "Connect Bank Account"                    
       ▼                                                      
┌─────────────┐                                               
│ Frontend    │                                               
│ Calls       │  POST /connect/create-account-link          
│ Backend     │  { userId, email }                           
└──────┬──────┘                                               
       │                                                      
       │ 3. Backend responds with account link              
       ▼                                                      
┌─────────────┐                                               
│  Stripe     │                                               
│  Connect    │  User completes onboarding                   
│  Onboarding │  Links bank account                          
└──────┬──────┘                                               
       │                                                      
       │ 4. Return to app with accountId                    
       ▼                                                      
┌─────────────┐                                               
│  Withdraw   │                                               
│  Screen     │  Now shows "Bank Account (Connected)"        
└──────┬──────┘                                               
       │                                                      
       │ 5. Enter amount, click "Withdraw"                  
       ▼                                                      
┌─────────────┐                                               
│ Frontend    │                                               
│ Calls       │  POST /connect/transfer                      
│ Backend     │  { accountId, amount, currency }             
└──────┬──────┘                                               
       │                                                      
       │ 6. Create transfer                                 
       ▼                                                      
┌─────────────┐                                               
│  Stripe     │                                               
│  Transfer   │  Initiate bank transfer                      
│  API        │  Est. 1-3 business days                      
└──────┬──────┘                                               
       │                                                      
       │ 7. Return transfer status                          
       ▼                                                      
┌─────────────┐                                               
│  User       │                                               
│  Sees       │  "Transfer initiated"                        
│  Pending    │  "Estimated arrival: 1-3 days"              
│  Status     │                                               
└─────────────┘                                               
```

## Component Updates: Before & After

### Add Money Screen

```
BEFORE:                          AFTER:
┌──────────────────┐            ┌──────────────────┐
│   Add Money      │            │   Add Money      │
├──────────────────┤            ├──────────────────┤
│                  │            │                  │
│    $0.00         │            │    $50.00        │
│                  │            │                  │
│  [1] [2] [3]     │            │  [1] [2] [3]     │
│  [4] [5] [6]     │            │  [4] [5] [6]     │
│  [7] [8] [9]     │            │  [7] [8] [9]     │
│  [.] [0] [⌫]     │            │  [.] [0] [⌫]     │
│                  │            │                  │
│ Mock Payment     │   →        │ Real Backend     │
│ Processing       │            │ Integration      │
│                  │            │                  │
│ [Add Money]      │            │ [Processing...]  │
└──────────────────┘            └──────────────────┘
  - In-memory mock                - Calls backend API
  - No real Stripe                - Gets clientSecret
  - Instant success               - Real validation
```

### Withdraw Screen

```
BEFORE:                          AFTER:
┌──────────────────┐            ┌──────────────────┐
│   Withdraw       │            │   Withdraw       │
├──────────────────┤            ├──────────────────┤
│ Balance: $40     │            │ Balance: $40     │
│                  │            │                  │
│ Payment Methods: │            │ Withdrawal:      │
│                  │            │                  │
│ ○ VISA ••4242   │            │ ● Bank Account   │
│ ○ MC   ••5555   │            │   (Connected)    │
│                  │   →        │   ✓ Recommended  │
│ "Coming soon"    │            │                  │
│ bank transfers   │            │ ────────────────│
│                  │            │                  │
│                  │            │ ○ VISA ••4242   │
│                  │            │ ○ MC   ••5555   │
│                  │            │                  │
│                  │            │ ℹ Processing:    │
│                  │            │ • Banks: 1-3 days│
│                  │            │ • Cards: 5-10 d  │
│                  │            │                  │
│ [Withdraw]       │            │ [Withdraw $40]   │
└──────────────────┘            └──────────────────┘
  - Card refunds only             - Bank transfers
  - No Connect                    - Connect scaffold
  - Basic info                    - Processing times
```

### Payment Methods Modal

```
BEFORE:                          AFTER:
┌──────────────────┐            ┌──────────────────┐
│ ═ Payment Methods│            │ ═══              │
├──────────────────┤            │ Payment Methods  │
│                  │            ├──────────────────┤
│ [+ Add New Card] │            │                  │
│  (small)         │   →        │ [+ Add New Card] │
│                  │            │  (56px height)   │
│ 💳 VISA ••4242  │            │                  │
│ (tight)   [🗑]  │            │ 💳  VISA         │
│                  │            │     ••••4242     │
│ 💳 MC ••5555    │            │     Exp 12/25    │
│ (tight)   [🗑]  │            │            [🗑]  │
│                  │            │  (72px height)   │
│                  │            │                  │
└──────────────────┘            │ 💳  MASTERCARD   │
  - 32px touch areas              │     ••••5555     │
  - 12px padding                  │     Exp 06/26    │
  - 14px text                     │            [🗑]  │
  - Small icons                   │  (72px height)   │
                                  │                  │
                                  │ (Shadows, depth) │
                                  └──────────────────┘
                                    - 44pt targets
                                    - 18px padding
                                    - 16px text
                                    - 34px icons
```

### Transaction History

```
BEFORE:                          AFTER:
┌──────────────────┐            ┌──────────────────┐
│ BOUNTY           │            │ BOUNTY           │
│ Transaction      │            │ Transaction      │
│ History          │            │ History          │
├──────────────────┤            ├──────────────────┤
│[All][Dep][With] │            │ [All Transactions]│
│  (small)         │   →        │ [Deposits]       │
│                  │            │ [Withdrawals]    │
│ Today            │            │ [Bounties]       │
│ • Deposit $50    │            │  (44pt height)   │
│   +$50.00        │            │                  │
│   (compact)      │            │ Today            │
│                  │            │                  │
│ Yesterday        │            │ 💳  Deposit      │
│ • Withdraw $20   │            │     via Card     │
│   -$20.00        │            │     +$50.00      │
│   (compact)      │            │  (80px height)   │
│                  │            │                  │
└──────────────────┘            │ Yesterday        │
  - Small items                   │                  │
  - 14px text                     │ 💳  Withdrawal   │
  - Tight spacing                 │     to Card      │
                                  │     -$20.00      │
                                  │  (80px height)   │
                                  │                  │
                                  └──────────────────┘
                                    - 44px icons
                                    - 16px amounts
                                    - Better hierarchy
```

## File Structure

```
bountyexpo/
│
├── server/                              ← NEW DIRECTORY
│   ├── .env.example                    ← Environment template
│   ├── .gitignore                      ← Ignore secrets
│   ├── README.md                       ← Server docs
│   ├── index.js                        ← Express server
│   ├── package.json                    ← Dependencies
│   └── wallet-transactions.json        ← Demo storage
│
├── components/
│   ├── add-money-screen.tsx           ← MODIFIED (backend calls)
│   ├── withdraw-screen.tsx            ← MODIFIED (Connect flow)
│   ├── payment-methods-modal.tsx      ← MODIFIED (iPhone UI)
│   └── transaction-history-screen.tsx ← MODIFIED (iPhone UI)
│
├── STRIPE_INTEGRATION_BACKEND.md      ← NEW (10k chars)
├── IMPLEMENTATION_SUMMARY_...md        ← NEW (summary)
├── STRIPE_BACKEND_VISUAL_GUIDE.md     ← THIS FILE
└── README.md                           ← MODIFIED (server info)
```

## Security Flow

```
┌────────────────────────────────────────────────────────────┐
│                     Security Layers                         │
└────────────────────────────────────────────────────────────┘

1. ENVIRONMENT VARIABLES
   ┌─────────────────────────────────────────────┐
   │  .env file (gitignored)                     │
   │  • STRIPE_SECRET_KEY                        │
   │  • STRIPE_WEBHOOK_SECRET                    │
   │  • PORT, NODE_ENV, ALLOWED_ORIGINS          │
   └─────────────────────────────────────────────┘
                    ↓
2. CORS CONFIGURATION
   ┌─────────────────────────────────────────────┐
   │  Only allowed origins can access API        │
   │  • localhost:8081 (Expo)                    │
   │  • localhost:19000 (Expo Go)                │
   │  • Your production domain                   │
   └─────────────────────────────────────────────┘
                    ↓
3. INPUT VALIDATION
   ┌─────────────────────────────────────────────┐
   │  Validate all requests                      │
   │  • Amount must be positive integer          │
   │  • Currency must be valid                   │
   │  • Account ID required for transfers        │
   └─────────────────────────────────────────────┘
                    ↓
4. WEBHOOK VERIFICATION
   ┌─────────────────────────────────────────────┐
   │  stripe.webhooks.constructEvent()           │
   │  • Verify signature with secret             │
   │  • Reject invalid signatures                │
   │  • Prevent replay attacks                   │
   └─────────────────────────────────────────────┘
                    ↓
5. ERROR HANDLING
   ┌─────────────────────────────────────────────┐
   │  Don't expose internals                     │
   │  • Generic error messages                   │
   │  • Log details server-side                  │
   │  • Return appropriate status codes          │
   └─────────────────────────────────────────────┘
```

## Development Workflow

```
┌─────────────────────────────────────────────────────────────┐
│                    Development Setup                         │
└─────────────────────────────────────────────────────────────┘

STEP 1: Clone & Install
┌──────────────────────────┐
│ git clone repo           │
│ cd bountyexpo            │
│ npm install              │
│ cd server && npm install │
└──────────────────────────┘
            ↓
STEP 2: Configure Stripe
┌──────────────────────────┐
│ Create Stripe account    │
│ Get test API keys        │
│ Copy to server/.env      │
└──────────────────────────┘
            ↓
STEP 3: Setup Webhooks
┌──────────────────────────┐
│ stripe login             │
│ stripe listen --forward  │
│ Copy webhook secret      │
└──────────────────────────┘
            ↓
STEP 4: Start Services
┌──────────────────────────┐
│ Terminal 1: npm start    │ ← Expo app
│ Terminal 2: server start │ ← Backend
│ Terminal 3: stripe listen│ ← Webhooks
└──────────────────────────┘
            ↓
STEP 5: Test
┌──────────────────────────┐
│ Open app on device       │
│ Add money to wallet      │
│ Check server logs        │
│ Verify webhook events    │
└──────────────────────────┘
```

## Status Indicators

```
✅ Complete & Tested
🚧 Scaffold/Mock (TODO)
⚠️  Production Required
❌ Not Implemented

Backend Endpoints:
✅ GET  /health
✅ POST /payments/create-payment-intent
✅ POST /webhooks/stripe
🚧 POST /connect/create-account-link (mock)
🚧 POST /connect/transfer (mock)

Frontend Components:
✅ add-money-screen.tsx (backend integration)
✅ withdraw-screen.tsx (Connect scaffold)
✅ payment-methods-modal.tsx (iPhone UI)
✅ transaction-history-screen.tsx (iPhone UI)

Documentation:
✅ STRIPE_INTEGRATION_BACKEND.md
✅ server/README.md
✅ IMPLEMENTATION_SUMMARY_STRIPE_BACKEND.md
✅ STRIPE_BACKEND_VISUAL_GUIDE.md
✅ README.md updates

Security:
✅ Webhook signature verification
✅ Input validation
✅ CORS configuration
✅ Environment variables
⚠️  Rate limiting (production)
⚠️  Authentication (production)
⚠️  Database (production)

Testing:
✅ Manual endpoint testing
✅ Input validation testing
✅ Error handling testing
✅ iPhone UI verification
❌ Automated tests (TODO)
❌ Load testing (TODO)
```

## Next Steps Visualization

```
┌──────────────────────────────────────────────────────────────┐
│                    Implementation Roadmap                     │
└──────────────────────────────────────────────────────────────┘

PHASE 1: Testing & Validation (Current)
├─ ✅ Backend server working
├─ ✅ Endpoints tested manually
├─ ✅ Frontend integrated
├─ ✅ Documentation complete
└─ ✅ Security scan passed

PHASE 2: Complete Integration (Next)
├─ ⚠️  Full Stripe SDK in frontend
├─ ⚠️  User authentication context
├─ ⚠️  Real Stripe Connect implementation
├─ ⚠️  Database instead of JSON
└─ ⚠️  Production Stripe keys

PHASE 3: Production Ready
├─ ⚠️  HTTPS/SSL certificates
├─ ⚠️  Rate limiting
├─ ⚠️  Comprehensive logging
├─ ⚠️  Monitoring/alerting
└─ ⚠️  Backup/disaster recovery

PHASE 4: Scaling
├─ ❌ Load balancing
├─ ❌ Redis caching
├─ ❌ Multiple regions
├─ ❌ CDN integration
└─ ❌ Performance optimization
```

---

**Document Version:** 1.0.0  
**Last Updated:** 2025-11-02  
**Status:** ✅ Complete  
**Next Review:** After production deployment
