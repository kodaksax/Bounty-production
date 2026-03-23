# Multiple Environment Setup: Development, Preview, and Production

This document outlines the strategy, benefits, and implementation steps for transitioning the BountyExpo codebase to a multi-environment setup.

## Overview

A robust environment strategy ensures that development work is isolated from production, providing a safe space for testing and a stable experience for end-users.

| Environment | Purpose | Target Audience | Data Source |
| :--- | :--- | :--- | :--- |
| **Development** | Local coding and feature development. | Internal Developers | Local DB / Dev Supabase |
| **Preview** | Staging/Beta testing, PR previews, and QA. | QA Team / Stakeholders | Staging DB / Staging Supabase |
| **Production** | Live application for all users. | End Users | Production DB / Prod Supabase |

---

## Pros and Cons

### Pros
- **Isolation**: Prevents development bugs or accidental data deletion from affecting live users.
- **Safety**: Allows for testing of migrations, infrastructure changes, and third-party integrations (Stripe, Apple/Google Auth) in a production-like environment.
- **Reliability**: Ensures that only thoroughly tested code reaches production.
- **Environment-Specific Config**: Tailor settings (logging levels, feature flags, API timeouts) for each stage.

### Cons
- **Management Overhead**: Requires maintaining multiple sets of environment variables, databases, and third-party service accounts.
- **Cost**: Potentially higher infrastructure costs due to multiple database instances and hosting environments.
- **Synchronization**: Increases the complexity of keeping database schemas and configurations in sync across all environments.

---

## Implementation Steps

### 1. Environment Variable Management

#### Local Development
Current setup uses a single `.env` file. Shift to using specific suffixes:
- `.env.development` (for `npm run dev`)
- `.env.preview` (for staging builds)
- `.env.production` (for production builds)

#### Backend (Node.js API)
Update `services/api/src/config/index.ts` to load the appropriate file based on `NODE_ENV`.

```typescript
// services/api/src/config/index.ts
const envFile = process.env.NODE_ENV ? `.env.${process.env.NODE_ENV}` : '.env';
dotenv.config({ path: path.resolve(process.cwd(), envFile) });
```

#### Mobile App (Expo)
Expo uses `EXPO_PUBLIC_` prefixed variables. These are baked into the build at compile time.

### 2. EAS Configuration (`eas.json`)

Update `eas.json` to define build profiles for each environment. This is where you inject environment-specific variables for mobile builds.

```json
{
  "build": {
    "development": {
      "channel": "development",
      "env": { "EXPO_PUBLIC_ENVIRONMENT": "development" }
    },
    "preview": {
      "channel": "preview",
      "distribution": "internal",
      "env": {
        "EXPO_PUBLIC_SUPABASE_URL": "${STAGING_SUPABASE_URL}",
        "EXPO_PUBLIC_ENVIRONMENT": "preview"
      }
    },
    "production": {
      "channel": "production",
      "distribution": "store",
      "env": {
        "EXPO_PUBLIC_SUPABASE_URL": "${PRODUCTION_SUPABASE_URL}",
        "EXPO_PUBLIC_ENVIRONMENT": "production"
      }
    }
  }
}
```

### 3. Supabase Branching

Utilize Supabase's branching feature or maintain separate projects:
- **Project A**: Development (local/hosted)
- **Project B**: Staging (Staging/Preview)
- **Project C**: Production

### 4. CI/CD Integration (GitHub Actions)

Update workflows to trigger deployments based on the branch:
- **`main`**: Deploys to **Preview** environment.
- **`release/*` / Tag**: Deploys to **Production**.

Example snippet for GitHub Actions:
```yaml
- name: Build and Push
  run: npx eas build --platform ios --profile ${{ github.ref == 'refs/heads/main' && 'preview' || 'production' }}
```

### 5. Codebase Usage Patterns

Always access environment variables through a central configuration object rather than `process.env` directly in feature code.

**Good:**
```typescript
import { config } from '../config';
const url = config.supabase.url;
```

**Avoid:**
```typescript
const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
```

---

## Best Practices

1. **Never Commit Secrets**: Ensure all `.env.*` files are in `.gitignore`. Use a secret manager for production keys.
2. **Schema Migrations**: Always test database migrations in the **Preview** environment before applying them to **Production**.
3. **Feature Flags**: Use environment-specific feature flags to hide incomplete work even if it has been merged to the main branch.
4. **Parity**: Keep the **Preview** environment as identical to **Production** as possible (same DB version, same Node.js runtime).
