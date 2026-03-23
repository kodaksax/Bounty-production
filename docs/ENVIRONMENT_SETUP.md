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
Current setup uses environment-specific files with a prioritized lookup. Use these filenames:
- `.env.development` (for local development / `NODE_ENV=development`)
- `.env.preview` (for preview / staging builds)
- `.env.production` (for production builds)

Environment loading behavior implemented in the codebase:
1. Compute `envName = process.env.NODE_ENV ? `.env.${String(process.env.NODE_ENV).toLowerCase()}` : '.env'` (NODE_ENV normalized to lowercase).
2. Try service-local env file first (e.g., `services/api/.env.preview`).
3. Fall back to the repository root env file (e.g., `.env.preview` at repo root).
4. Fall back to loading the plain `.env` file at repo root.

This ensures predictable loading regardless of where a script is executed and supports per-service overrides.

#### Backend (Node.js API)
Backend code now prefers `.env.<lowercase-node-env>` with service-local and repo-root fallbacks.

Example behavior (already implemented in `services/api` and helper scripts):

```typescript
const envName = process.env.NODE_ENV ? `.env.${String(process.env.NODE_ENV).toLowerCase()}` : '.env';
// Service-local path: services/api/<envName>
// Repo-root fallback: <repo>/.env.<envName> then <repo>/.env
dotenv.config({ path: resolvedPath });
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

**Commit non-secret examples:** Commit `.env.*.example` templates (no real secrets) to the repo so developers and CI have a reference. Keep actual `.env` and `.env.*` with secrets excluded by `.gitignore`.
2. **Schema Migrations**: Always test database migrations in the **Preview** environment before applying them to **Production**.
3. **Feature Flags**: Use environment-specific feature flags to hide incomplete work even if it has been merged to the main branch.
4. **Parity**: Keep the **Preview** environment as identical to **Production** as possible (same DB version, same Node.js runtime).
