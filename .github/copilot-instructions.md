# Copilot Instructions for BOUNTYExpo

## Project Overview
- **BOUNTYExpo** is a React Native app built with [Expo](https://expo.dev), using TypeScript and file-based routing (see `app/`).
- The app is organized by feature: screens, modals, UI components, and utilities are grouped in `components/`, with further subfolders for domains (e.g., `auth/`, `bounty/`, `ui/`).
- Data and business logic are handled in `lib/` (types, services, utils) and `hooks/` (custom React hooks).

## Key Patterns & Conventions
- **File-based routing**: Pages/screens are defined in `app/` (e.g., `app/index.tsx`, `app/_layout.tsx`).
- **Component structure**: UI and logic are split into small, reusable components in `components/`, with domain-specific subfolders.
- **State & data**: Use React hooks for state and side effects. Shared logic lives in `hooks/` and `lib/utils.ts`.
- **Styling**: Uses global CSS (`app/global.css`) and component-level styles. Follow existing patterns for theming and layout.
- **Type safety**: All code should use TypeScript types, especially for props and API responses. See `lib/types.ts` for shared types.

## Developer Workflows
- **Install dependencies**: `npm install`
- **Start development server**: `npx expo start`
- **Reset project**: `npm run reset-project` (moves starter code to `app-example/` and creates a blank `app/`)
- **Add new screens/components**: Place in `components/` or `app/` as appropriate. Use domain subfolders for organization.
- **Fonts & images**: Store in `assets/fonts/` and `assets/images/`.

## Integration & Communication
- **Navigation**: Managed by Expo Router via file structure in `app/`.
- **Modals & dialogs**: Implemented as components in `components/` (e.g., `bounty-detail-modal.tsx`, `transaction-detail-modal.tsx`).
- **External dependencies**: See `package.json` for UI libraries and utilities. Use `npm uninstall`/`install` for changes.

## Examples
- To add a new bounty form, see `components/bounty/bounty-form.tsx`.
- For authentication, see `components/auth/`.
- For UI primitives, see `components/ui/`.

## Project-Specific Notes
- Avoid duplicating logic between screens and components—prefer extracting to `hooks/` or `lib/utils/`.
- Follow the established folder structure for scalability and clarity.
- Use TypeScript throughout; avoid any usage of `any` type.

---
For more, see `README.md` and explore the `components/`, `app/`, and `lib/` directories for concrete examples.
