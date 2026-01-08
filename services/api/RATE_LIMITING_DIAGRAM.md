# Rate Limiting Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Client Applications                          │
│  (Mobile Apps, Web Browsers, API Clients)                          │
└────────────────────┬────────────────────────────────────────────────┘
                     │
                     │ HTTP POST /auth/sign-in
                     │ {"email": "user@example.com", "password": "..."}
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    API Server (Fastify)                             │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │  @fastify/rate-limit Plugin                                    │ │
│  │  ┌─────────────────────────────────────────────────────────┐  │ │
│  │  │  1. Extract Key: IP + Email                             │  │ │
│  │  │     Key = "192.168.1.100-user@example.com"              │  │ │
│  │  │                                                           │  │ │
│  │  │  2. Sanitize Email                                       │  │ │
│  │  │     - Convert to lowercase                               │  │ │
│  │  │     - Remove invalid characters                          │  │ │
│  │  │     - Limit length to 254 chars                          │  │ │
│  │  └─────────────────────────────────────────────────────────┘  │ │
│  │                                                                 │ │
│  │  ┌─────────────────────────────────────────────────────────┐  │ │
│  │  │  3. Query Redis Store                                    │  │ │
│  │  │     GET "bountyexpo:rl:auth:192.168.1.100-user@..."    │  │ │
│  │  └─────────────────────────────────────────────────────────┘  │ │
│  └───────────────────────────┬─────────────────────────────────────┘ │
│                              │                                       │
│                              ▼                                       │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Rate Limit Check                                            │   │
│  │  ┌────────────────────┐     ┌────────────────────┐          │   │
│  │  │ Current: 3         │ VS  │ Max: 5             │          │   │
│  │  │ Remaining: 2       │     │ Window: 15 min     │          │   │
│  │  └────────────────────┘     └────────────────────┘          │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                       │
│                    ┌─────────┴──────────┐                           │
│                    ▼                    ▼                           │
│         ┌──────────────────┐  ┌──────────────────┐                 │
│         │ Within Limit     │  │ Exceeded Limit   │                 │
│         │ (attempts ≤ 5)   │  │ (attempts > 5)   │                 │
│         └──────┬───────────┘  └──────┬───────────┘                 │
│                │                     │                              │
│                ▼                     ▼                              │
│    ┌──────────────────────┐  ┌──────────────────────┐             │
│    │ Increment Counter    │  │ Return HTTP 429      │             │
│    │ Add Headers:         │  │ Headers:             │             │
│    │ X-RateLimit-Limit: 5 │  │ X-RateLimit-Limit: 5 │             │
│    │ X-RateLimit-Remaining│  │ X-RateLimit-Remain: 0│             │
│    │ X-RateLimit-Reset    │  │ Retry-After: 600s    │             │
│    └──────┬───────────────┘  └──────┬───────────────┘             │
│           │                         │                              │
│           ▼                         │                              │
│    ┌──────────────────────┐         │                              │
│    │ Process Auth Request │         │                              │
│    │ (Supabase Sign In)   │         │                              │
│    └──────┬───────────────┘         │                              │
│           │                         │                              │
└───────────┼─────────────────────────┼──────────────────────────────┘
            │                         │
            ▼                         ▼
   ┌─────────────────┐       ┌─────────────────┐
   │ HTTP 200/401    │       │ HTTP 429        │
   │ (Success/Fail)  │       │ Rate Limited    │
   └─────────────────┘       └─────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                         Redis Storage                               │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │  Key Structure:                                                │ │
│  │  bountyexpo:rl:auth:192.168.1.100-user@example.com            │ │
│  │                                                                │ │
│  │  Value: 3 (attempt count)                                     │ │
│  │  TTL: 847 seconds (remaining time in window)                  │ │
│  │                                                                │ │
│  │  Operations (Atomic via MULTI/EXEC):                          │ │
│  │  1. INCR key        → Increment counter                       │ │
│  │  2. PTTL key        → Get remaining TTL                       │ │
│  │  3. EXPIRE key 900  → Set expiration (if new key)            │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  Auto-Cleanup: Keys automatically expire after 15 minutes          │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                    Multi-Instance Scenario                          │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐            │
│  │ API Server  │    │ API Server  │    │ API Server  │            │
│  │  Instance 1 │    │  Instance 2 │    │  Instance 3 │            │
│  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘            │
│         │                  │                  │                     │
│         └──────────────────┼──────────────────┘                     │
│                            │                                        │
│                    Shared Redis Store                               │
│         ┌──────────────────────────────────────┐                   │
│         │ Rate limits enforced across ALL      │                   │
│         │ instances via centralized Redis      │                   │
│         └──────────────────────────────────────┘                   │
└─────────────────────────────────────────────────────────────────────┘

Security Features:
═══════════════════

1. Brute Force Protection
   - Limit: 5 attempts per 15 minutes
   - Prevents password guessing attacks

2. Account Enumeration Prevention
   - Same error messages for valid/invalid emails
   - Rate limit by IP + email combination

3. Distributed Protection
   - Works across multiple API instances
   - Attackers can't bypass by hitting different servers

4. Input Sanitization
   - Email addresses sanitized before use in Redis keys
   - Prevents key collision attacks
   - Prevents Redis injection

5. Credential Security
   - No passwords in logs or URLs
   - Secure Redis connection handling

6. Standard Compliance
   - RFC 6585 (HTTP 429)
   - Draft RateLimit headers
   - Proper Retry-After guidance
```
