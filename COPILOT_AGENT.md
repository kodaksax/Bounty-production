# Copilot Coding Agent Instructions

## Repository: bountyexpo

Welcome to the Copilot Coding Agent! This file provides onboarding and best practices for using Copilot in this repository.

---

## 1. Project Overview

- **Project Name:** bountyexpo
- **Main Language/Framework:** TypeScript, React (likely Next.js or Expo)
- **Key Directories:**
  - `app/` — Main application code
  - `components/` — UI and feature components
  - `hooks/` — Custom React hooks
  - `lib/` — Utilities, types, and services
  - `assets/` — Fonts and images

---

## 2. Copilot Coding Agent Best Practices

### a. General Guidelines
- **Always prefer clarity and maintainability over cleverness.**
- **Follow the existing code style and conventions.**
- **Use TypeScript types and interfaces where appropriate.**
- **Document public functions, components, and utilities.**
- **Group related files and components logically.**

### b. File and Folder Structure
- Place new screens in `components/` or `app/` as appropriate.
- Place shared UI elements in `components/ui/`.
- Place custom hooks in `hooks/`.
- Place utility functions in `lib/utils.ts` or `lib/services/`.
- Place shared types in `lib/types.ts`.

### c. Naming Conventions
- Use `kebab-case` for file and folder names.
- Use `PascalCase` for React components and TypeScript types.
- Use `camelCase` for variables and functions.

### d. Commit and PR Guidelines
- Write clear, descriptive commit messages.
- Reference related issues or tasks in PRs.
- Ensure all code passes linting and type checks before merging.

### e. Testing
- Add or update tests for new features and bug fixes (if test setup exists).
- Prefer unit tests for utilities and hooks.
- Prefer integration tests for components and screens.

---

## 3. Copilot Coding Agent Usage

- **Onboarding:**
  - Read this file before making changes.
  - Ask for clarification if requirements are ambiguous.
- **When implementing features:**
  - Break down tasks into logical steps.
  - Use the todo list to track progress for multi-step changes.
  - Validate changes with lint/type checks and run the app if possible.
- **When refactoring:**
  - Ensure no regressions are introduced.
  - Update related documentation and types.

---

## 4. Additional Notes

- If you are unsure about a pattern, check for similar examples in the codebase.
- For design/UI, follow the existing style in `global.css` and `components/ui/`.
- For new dependencies, update `package.json` and run `npm install`.

---

## 5. Resources

- [Copilot Coding Agent Best Practices](https://gh.io/copilot-coding-agent-tips)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/)
- [React Docs](https://react.dev/learn)

---

*This file is intended to help onboard Copilot Coding Agent and contributors to this repository. Please keep it up to date as the project evolves.*
