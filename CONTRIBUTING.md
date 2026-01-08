# Contributing to BountyExpo

Thank you for your interest in contributing to BountyExpo! This document provides guidelines and instructions for contributing to the project.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Coding Standards](#coding-standards)
- [Testing Guidelines](#testing-guidelines)
- [Pull Request Process](#pull-request-process)
- [Commit Message Guidelines](#commit-message-guidelines)
- [Issue Reporting](#issue-reporting)
- [Documentation](#documentation)

---

## Code of Conduct

### Our Pledge

We are committed to providing a welcoming and inspiring community for all. Please be respectful and constructive in all interactions.

### Expected Behavior

- Use welcoming and inclusive language
- Be respectful of differing viewpoints and experiences
- Gracefully accept constructive criticism
- Focus on what is best for the community
- Show empathy towards other community members

### Unacceptable Behavior

- Trolling, insulting/derogatory comments, and personal or political attacks
- Public or private harassment
- Publishing others' private information without explicit permission
- Other conduct which could reasonably be considered inappropriate

---

## Getting Started

### Prerequisites

Before you begin, ensure you have:

- **Node.js 18+** installed
- **pnpm** package manager
- **Docker & Docker Compose** for local services
- **Git** for version control
- **VS Code** (recommended) with recommended extensions

### Initial Setup

1. **Fork the repository**
   ```bash
   # Click "Fork" button on GitHub, then:
   git clone https://github.com/YOUR_USERNAME/Bounty-production.git
   cd Bounty-production
   ```

2. **Add upstream remote**
   ```bash
   git remote add upstream https://github.com/kodaksax/Bounty-production.git
   ```

3. **Install dependencies**
   ```bash
   pnpm install
   ```

4. **Set up environment**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

5. **Start development services**
   ```bash
   pnpm dev          # Start PostgreSQL + Redis + Stripe Mock
   pnpm dev:api      # In new terminal: Start API server
   pnpm start        # In new terminal: Start Expo app
   ```

---

## Development Workflow

### Branching Strategy

We use a simplified Git Flow:

- `main` - Production-ready code
- `develop` - Integration branch for features
- `feature/*` - New features
- `fix/*` - Bug fixes
- `docs/*` - Documentation updates
- `refactor/*` - Code refactoring
- `test/*` - Test improvements

### Creating a Feature Branch

```bash
# Update your local repository
git checkout main
git pull upstream main

# Create a feature branch
git checkout -b feature/your-feature-name

# Make your changes...

# Push to your fork
git push origin feature/your-feature-name
```

### Keeping Your Branch Updated

```bash
# Fetch latest changes
git fetch upstream

# Rebase your branch
git rebase upstream/main

# Force push if needed (be careful!)
git push origin feature/your-feature-name --force-with-lease
```

---

## Coding Standards

### TypeScript Guidelines

- **Use TypeScript** for all new code
- **Enable strict mode** in tsconfig.json
- **Avoid `any` type** - use `unknown` and type guards instead
- **Use interfaces** for object shapes, **types** for unions/intersections

#### Good Examples

```typescript
// ✅ Good - Explicit types
interface BountyFormData {
  title: string;
  description: string;
  amount: number;
}

function createBounty(data: BountyFormData): Promise<Bounty> {
  // ...
}

// ✅ Good - Type guards
function isBounty(value: unknown): value is Bounty {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'title' in value
  );
}
```

#### Bad Examples

```typescript
// ❌ Bad - Using any
function processData(data: any) {
  return data.title.toUpperCase();
}

// ❌ Bad - Missing types
function createBounty(data) {
  // ...
}
```

### React/React Native Guidelines

- **Use functional components** with hooks (no class components)
- **Use custom hooks** for reusable logic
- **Memoize expensive computations** with `useMemo`
- **Memoize callbacks** with `useCallback` when passed as props
- **Use React.memo** for presentational components

#### Good Examples

```typescript
// ✅ Good - Functional component with proper typing
interface BountyCardProps {
  bounty: Bounty;
  onPress: () => void;
}

export const BountyCard = React.memo<BountyCardProps>(({ bounty, onPress }) => {
  return (
    <TouchableOpacity onPress={onPress}>
      <Text>{bounty.title}</Text>
    </TouchableOpacity>
  );
});

// ✅ Good - Custom hook
function useBounties(status: BountyStatus) {
  const [bounties, setBounties] = useState<Bounty[]>([]);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    fetchBounties(status).then(setBounties).finally(() => setLoading(false));
  }, [status]);
  
  return { bounties, loading };
}
```

### Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| React Components | PascalCase | `BountyCard`, `UserProfile` |
| Hooks | camelCase with 'use' prefix | `useBounties`, `useAuth` |
| Functions | camelCase | `createBounty`, `formatDate` |
| Variables | camelCase | `bountyList`, `userId` |
| Constants | UPPER_SNAKE_CASE | `API_BASE_URL`, `MAX_RETRIES` |
| Types/Interfaces | PascalCase | `Bounty`, `UserProfile` |
| Files (components) | PascalCase | `BountyCard.tsx` |
| Files (utilities) | kebab-case | `format-date.ts` |
| Folders | kebab-case | `user-profile`, `bounty-list` |

### File Organization

```
src/
  ├── components/           # Reusable UI components
  │   ├── ui/               # Generic UI elements
  │   ├── bounty/           # Bounty-specific components
  │   └── profile/          # Profile-specific components
  ├── hooks/                # Custom React hooks
  ├── lib/
  │   ├── services/         # Business logic services
  │   ├── utils/            # Utility functions
  │   └── types.ts          # Shared type definitions
  ├── app/                  # App screens (Expo Router)
  └── providers/            # Context providers
```

### Code Style

We use ESLint and Prettier for code formatting:

```bash
# Check code style
pnpm lint

# Auto-fix issues
pnpm lint --fix

# Format code
pnpm format
```

**Key Rules:**
- Use 2 spaces for indentation
- Use single quotes for strings
- Include trailing commas in objects/arrays
- Max line length: 100 characters
- No semicolons (where optional)

---

## Testing Guidelines

### Test Categories

1. **Unit Tests** - Test individual functions/components
2. **Integration Tests** - Test component interactions
3. **E2E Tests** - Test complete user flows
4. **API Tests** - Test backend endpoints

### Running Tests

```bash
# Run all tests
pnpm test

# Run specific test suite
pnpm test:unit
pnpm test:integration
pnpm test:e2e

# Run tests in watch mode
pnpm test:watch

# Run tests with coverage
pnpm test:coverage
```

### Writing Tests

#### Unit Test Example

```typescript
// bountyService.test.ts
import { describe, it, expect } from '@jest/globals';
import { createBounty } from './bountyService';

describe('bountyService', () => {
  describe('createBounty', () => {
    it('should create a bounty with valid data', async () => {
      const data = {
        title: 'Test bounty',
        description: 'This is a test bounty description that is long enough',
        amount: 5000
      };
      
      const bounty = await createBounty(data);
      
      expect(bounty).toHaveProperty('id');
      expect(bounty.title).toBe(data.title);
      expect(bounty.status).toBe('open');
    });
    
    it('should reject bounties with short titles', async () => {
      const data = {
        title: 'Short',
        description: 'This is a test bounty description that is long enough',
        amount: 5000
      };
      
      await expect(createBounty(data)).rejects.toThrow('Title must be at least 10 characters');
    });
  });
});
```

#### Component Test Example

```typescript
// BountyCard.test.tsx
import { render, fireEvent } from '@testing-library/react-native';
import { BountyCard } from './BountyCard';

describe('BountyCard', () => {
  const mockBounty = {
    id: '1',
    title: 'Test Bounty',
    description: 'Test description',
    amount: 5000,
    status: 'open'
  };
  
  it('should render bounty title', () => {
    const { getByText } = render(<BountyCard bounty={mockBounty} onPress={() => {}} />);
    expect(getByText('Test Bounty')).toBeTruthy();
  });
  
  it('should call onPress when pressed', () => {
    const onPress = jest.fn();
    const { getByText } = render(<BountyCard bounty={mockBounty} onPress={onPress} />);
    
    fireEvent.press(getByText('Test Bounty'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
```

### Test Coverage Goals

- **Critical Paths**: 90%+ coverage
- **Business Logic**: 80%+ coverage
- **UI Components**: 60%+ coverage
- **Overall Project**: 70%+ coverage

---

## Pull Request Process

### Before Creating a PR

1. **Update your branch** with latest changes from main
2. **Run all tests** and ensure they pass
3. **Run type checking** with `pnpm type-check`
4. **Run linting** with `pnpm lint`
5. **Test manually** on both iOS and Android (if UI changes)
6. **Update documentation** if needed

### Creating a Pull Request

1. **Push your branch** to your fork
2. **Open a PR** on GitHub
3. **Fill out the PR template** completely
4. **Link related issues** using keywords (Fixes #123, Closes #456)
5. **Add screenshots** for UI changes
6. **Request review** from maintainers

### PR Title Format

Use conventional commit format:

```
<type>(<scope>): <description>

Examples:
feat(bounties): add filter by category
fix(auth): resolve token refresh race condition
docs(api): update authentication endpoints
refactor(wallet): simplify transaction logic
test(bounties): add tests for bounty creation
```

### PR Description Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Related Issues
Fixes #123, Closes #456

## Testing
- [ ] Unit tests added/updated
- [ ] Integration tests added/updated
- [ ] Manual testing completed
- [ ] Tested on iOS
- [ ] Tested on Android

## Screenshots (if applicable)
[Add screenshots here]

## Checklist
- [ ] Code follows project style guidelines
- [ ] Self-review completed
- [ ] Comments added for complex code
- [ ] Documentation updated
- [ ] No new warnings
- [ ] Tests added and passing
```

### Review Process

1. **Automated Checks** - CI/CD pipeline runs
2. **Code Review** - At least one maintainer reviews
3. **Testing** - Reviewer tests changes locally
4. **Approval** - Reviewer approves PR
5. **Merge** - Maintainer merges to main

### Addressing Review Feedback

- **Be responsive** to review comments
- **Ask questions** if feedback is unclear
- **Make requested changes** in new commits
- **Re-request review** after changes
- **Be patient** - reviews take time

---

## Commit Message Guidelines

We follow [Conventional Commits](https://www.conventionalcommits.org/) specification.

### Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types

- `feat` - New feature
- `fix` - Bug fix
- `docs` - Documentation only
- `style` - Formatting, missing semicolons, etc.
- `refactor` - Code restructuring without behavior change
- `perf` - Performance improvement
- `test` - Adding or updating tests
- `chore` - Maintenance tasks, dependency updates
- `ci` - CI/CD changes
- `build` - Build system changes

### Scopes (optional but recommended)

- `bounties` - Bounty-related changes
- `auth` - Authentication changes
- `payments` - Payment-related changes
- `messaging` - Messaging/chat changes
- `wallet` - Wallet functionality
- `api` - Backend API changes
- `ui` - UI component changes

### Examples

```bash
# Good commit messages
git commit -m "feat(bounties): add ability to filter by location"
git commit -m "fix(auth): resolve token expiration race condition"
git commit -m "docs(api): add examples for payment endpoints"
git commit -m "refactor(wallet): simplify transaction calculation logic"
git commit -m "test(bounties): add tests for bounty acceptance flow"
git commit -m "perf(api): add caching for bounty list queries"

# Bad commit messages (avoid these)
git commit -m "fixed stuff"
git commit -m "WIP"
git commit -m "changes"
git commit -m "Update file.ts"
```

### Breaking Changes

Mark breaking changes with `BREAKING CHANGE:` in footer:

```bash
git commit -m "feat(api): change bounty status field

BREAKING CHANGE: Bounty status field renamed from 'state' to 'status'.
Clients must update to use the new field name."
```

---

## Issue Reporting

### Before Creating an Issue

1. **Search existing issues** to avoid duplicates
2. **Update to latest version** and test again
3. **Gather relevant information** (logs, screenshots, versions)

### Bug Report Template

```markdown
**Describe the bug**
A clear description of what the bug is.

**To Reproduce**
Steps to reproduce:
1. Go to '...'
2. Click on '...'
3. See error

**Expected behavior**
What you expected to happen.

**Screenshots**
If applicable, add screenshots.

**Environment**
- OS: [e.g., iOS 17, Android 13]
- App Version: [e.g., 1.2.0]
- Device: [e.g., iPhone 14, Pixel 7]

**Additional context**
Any other relevant information.
```

### Feature Request Template

```markdown
**Is your feature request related to a problem?**
A clear description of the problem.

**Describe the solution you'd like**
A clear description of what you want to happen.

**Describe alternatives you've considered**
Other solutions or features you've considered.

**Additional context**
Mockups, examples, or other context.
```

---

## Documentation

### Updating Documentation

When making changes that affect documentation:

1. **Update inline code comments** for complex logic
2. **Update README** if setup/usage changes
3. **Update API docs** if endpoints change
4. **Add JSDoc comments** for public APIs
5. **Update architecture docs** for structural changes

### Documentation Standards

#### JSDoc Comments

```typescript
/**
 * Creates a new bounty with the provided data.
 * 
 * @param data - Bounty creation data including title, description, and amount
 * @param userId - ID of the user creating the bounty
 * @returns Promise resolving to the created bounty
 * @throws {ValidationError} If data validation fails
 * @throws {AuthorizationError} If user is not authorized
 * 
 * @example
 * ```typescript
 * const bounty = await createBounty({
 *   title: 'Build a website',
 *   description: 'Need a professional website...',
 *   amount: 50000
 * }, userId);
 * ```
 */
export async function createBounty(
  data: BountyFormData,
  userId: string
): Promise<Bounty> {
  // Implementation...
}
```

#### API Documentation

When adding/modifying API endpoints, update `API_REFERENCE.md`:

```markdown
#### POST /bounties

Create a new bounty.

**Authentication:** Required

**Request:**
\`\`\`json
{
  "title": "Build a website",
  "description": "Need a professional website...",
  "amount": 50000
}
\`\`\`

**Response:** `201 Created`
\`\`\`json
{
  "id": "uuid",
  "title": "Build a website",
  "status": "open",
  "created_at": "2024-01-01T00:00:00Z"
}
\`\`\`

**Errors:**
- `400` - Invalid input data
- `401` - Not authenticated
```

---

## Questions?

- **Slack**: Join our [community Slack](https://bountyexpo.slack.com)
- **Email**: dev@bountyexpo.com
- **Discussions**: Use [GitHub Discussions](https://github.com/kodaksax/Bounty-production/discussions)

---

## License

By contributing to BountyExpo, you agree that your contributions will be licensed under the project's license.

---

**Thank you for contributing to BountyExpo!** 🎉
