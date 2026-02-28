# BountyExpo Monorepo

A monorepo setup for BountyExpo using pnpm workspaces with domain types and API services.

## 🏗️ Architecture

This monorepo contains:

- **`packages/domain-types`**: Shared TypeScript interfaces and Zod validation schemas
- **`services/api`**: Fastify-based API server with health endpoints
- **Root**: Mobile app (Expo/React Native) and shared configuration

## 📦 Packages

### `@bountyexpo/domain-types`

Contains all domain types and validation schemas:

- **Bounty**: Core bounty types with status management
- **UserProfile**: User management and profile data
- **WalletTransaction**: Financial transaction types with escrow support
- **Conversation**: Chat and messaging types

Each domain includes:
- TypeScript interfaces for type safety
- Zod schemas for runtime validation
- Input/output type variants

### `@bountyexpo/api`

Fastify-based API service with:
- Health check endpoint (`/health`)
- Proper logging and error handling
- Environment configuration
- Hot reload in development

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- pnpm (installed globally)

### Installation

```bash
pnpm install
```

### Development

Build all packages:
```bash
pnpm build
```

Start API server in development mode:
```bash
pnpm dev
```

Start all services in development mode:
```bash
pnpm dev:all
```

Type check all workspaces:
```bash
pnpm type-check
```

### Testing the API

Once the server is running, test the endpoints:

```bash
# Health check
curl http://localhost:3001/health

# Root endpoint
curl http://localhost:3001/
```

Expected health response:
```json
{
  "status": "ok",
  "timestamp": "2025-09-29T23:48:34.408Z",
  "version": "1.0.0",
  "service": "bountyexpo-api"
}
```

## 🛠️ Development Workflow

### Adding New Domain Types

1. Navigate to `packages/domain-types/src/`
2. Create or modify TypeScript interfaces
3. Add corresponding Zod schemas for validation
4. Export from `index.ts`
5. Run `pnpm build` to generate type definitions

### Using Domain Types in Services

```typescript
import { Bounty, BountySchema } from '@bountyexpo/domain-types';

// Use interface for typing
const bounty: Bounty = { /* ... */ };

// Use schema for validation
const validatedBounty = BountySchema.parse(data);
```

### API Development

1. Navigate to `services/api/src/`
2. Modify or add routes in `index.ts`
3. Use domain types for request/response typing
4. Run `pnpm dev` for hot reload

## 📁 Project Structure

```
├── packages/
│   └── domain-types/          # Shared types and schemas
│       ├── src/
│       │   ├── bounty.ts      # Bounty domain types
│       │   ├── user.ts        # User profile types
│       │   ├── wallet.ts      # Wallet transaction types
│       │   ├── conversation.ts # Chat/messaging types
│       │   └── index.ts       # Public exports
│       ├── package.json
│       └── tsconfig.json
├── services/
│   └── api/                   # Fastify API server
│       ├── src/
│       │   └── index.ts       # Main server file
│       ├── package.json
│       └── tsconfig.json
├── app/                       # Expo/React Native app
├── components/                # React components
├── lib/                       # Utilities and services
├── package.json               # Root package with workspaces
├── pnpm-workspace.yaml        # Workspace configuration
├── tsconfig.base.json         # Shared TypeScript config
├── .eslintrc.js              # ESLint configuration
└── .prettierrc               # Prettier configuration
```

## 🔧 Configuration

### TypeScript

- Base configuration in `tsconfig.base.json`
- Each workspace extends the base config
- Strict mode enabled with modern target (ES2020)

### Linting & Formatting

- ESLint with TypeScript support
- Prettier for code formatting
- Consistent rules across all workspaces

### Package Management

- pnpm workspaces for efficient dependency management
- Workspace protocol (`workspace:*`) for internal dependencies
- Shared dev dependencies at root level

## 🎯 Next Steps

- [ ] Add database integration to API service
- [ ] Implement authentication endpoints
- [ ] Add request/response validation middleware
- [ ] Set up automated testing
- [ ] Add API documentation with Swagger/OpenAPI
- [ ] Configure CI/CD pipeline
- [ ] Add Docker configuration

## 🤝 Contributing

1. Follow existing code patterns and naming conventions
2. Use domain types from `@bountyexpo/domain-types`
3. Ensure type checking passes: `pnpm type-check`
4. Test API changes manually or with automated tests
5. Update documentation for new features

---

*This monorepo structure provides a solid foundation for scaling the BountyExpo application with proper separation of concerns and shared type safety.*