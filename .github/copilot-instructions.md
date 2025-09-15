# Bounty Expo App - React Native Mobile Application

Always reference these instructions first and fallback to search or bash commands only when you encounter unexpected information that does not match the info here.

## Working Effectively

### Initial Setup & Installation
Bootstrap, build, and test the repository:
- `npm install` -- takes 1-2 minutes. Always run this first.
- `npx expo start --web` -- takes 5-7 minutes for initial build. NEVER CANCEL. Set timeout to 10+ minutes.
- `npm run lint` -- takes 30 seconds. Always run to check code quality.

### Build & Development Commands
- **Web Development**: `npx expo start --web` or `npm run web`
  - NEVER CANCEL: Initial build takes 5-7 minutes for Metro bundler. Subsequent rebuilds are ~1 second.
  - Access at http://localhost:8081
  - Expected warnings: "Failed to load offline error log queue" and AsyncStorage errors - these are normal for web builds
- **Mobile Development**: 
  - Android: `npm run android` (requires Android Studio/emulator)
  - iOS: `npm run ios` (requires Xcode/iOS Simulator on macOS)
  - Universal: `npm start` then scan QR code with Expo Go app

### Testing & Validation
- **Linting**: `npm run lint` -- identifies code quality issues. Currently has 39 issues (12 errors, 27 warnings)
- **Environment Check**: `npx expo-doctor` -- validates Expo environment (some network checks will fail offline)
- **No unit tests**: This repository has no test suite configured. Focus on manual testing.

### Timing Expectations
- `npm install`: 1-2 minutes
- Initial `npx expo start --web`: 5-7 minutes (NEVER CANCEL)
- Subsequent web rebuilds: 1-5 seconds
- `npm run lint`: 30 seconds
- Code changes trigger automatic rebuilds in ~1-3 seconds

## Validation Scenarios

### CRITICAL: Always manually validate changes via complete user scenarios
After making changes, ALWAYS test the following end-to-end scenarios:

1. **Application Launch**: Navigate to http://localhost:8081 and verify the app loads with green emerald background
2. **Basic Navigation**: Test that the mobile-style interface appears (even though some components may show as blank initially)
3. **Component Rendering**: Verify that any UI components you modified render correctly without TypeScript errors
4. **Build Verification**: Ensure `npm run lint` passes for the files you modified (ignore existing unrelated lint errors)

### Known Issues & Workarounds
- **Web UI appears blank**: This is expected during initial load. The app uses React Native components that may not fully render in web browser testing.
- **AsyncStorage errors**: Normal for web builds. These don't affect functionality.
- **Lint errors in existing code**: Focus only on linting your changes. Don't fix unrelated existing errors.
- **Expo doctor network failures**: Expected in offline environments. Not a blocker.

## Key Codebase Information

### Project Structure
```
/app                 # Expo Router pages (file-based routing)
  /_layout.tsx       # Root layout with ThemeProvider
  /index.tsx         # Home page that renders BountyApp component
/components          # All UI components
  /bounty-app.tsx    # Main app component
  /ui/               # Reusable UI components (Radix-based)
  /auth/             # Authentication components
/lib                 # Utilities and services
  /utils.ts          # Tailwind class utilities (cn function)
/hooks               # Custom React hooks
```

### Important Files to Know
- `components/bounty-app.tsx` - Main application component with navigation
- `app/_layout.tsx` - Root layout with styling and theme provider
- `components/ui/` - Contains all reusable UI components (buttons, modals, etc.)
- `lib/utils.ts` - Utility functions for styling (cn function for Tailwind)
- `tsconfig.json` - TypeScript configuration with path aliases
- `package.json` - Dependencies and npm scripts

### Technology Stack
- **Framework**: Expo (React Native for mobile + web)
- **Language**: TypeScript
- **Styling**: Tailwind CSS (via tailwind-merge and clsx)
- **UI Components**: Radix UI primitives for web
- **Navigation**: Expo Router (file-based routing)
- **State Management**: React hooks (no global state library)

### Dependencies & Architecture
- Uses React Native 0.81.4 with Expo SDK 54.x
- Heavy use of Radix UI components for accessible web UI
- Custom styling system using Tailwind + custom component variants
- File-based routing with Expo Router
- TypeScript with strict mode enabled

## Development Workflow

### Making Changes
1. Always run `npm install` if you haven't yet
2. Start development server: `npx expo start --web` (wait for build completion)
3. Make your code changes
4. Verify automatic rebuild completes successfully
5. Test your changes manually in browser at http://localhost:8081
6. Run `npm run lint` on files you modified
7. Always validate one complete user scenario before finishing

### Common Patterns
- Components use both React Native (View, Text, TouchableOpacity) and web (div, span) patterns
- Styling combines React Native StyleSheet and Tailwind classes
- Import paths use absolute imports via tsconfig paths (e.g., `"components/ui/button"`)
- TypeScript is configured with strict mode - address all type errors

### Performance Notes
- Metro bundler caches aggressively - restart if you see unexpected build issues
- Web builds include both React Native and web dependencies (large bundle size expected)
- Development builds include extensive debugging and hot reload capabilities

## Troubleshooting

### Build Issues
- If Metro bundler hangs: Stop process and restart with `npx expo start --web --clear`
- If TypeScript errors: Check import paths and ensure all dependencies are installed
- If component not rendering: Verify React Native vs web component compatibility

### Common Errors
- **"window is not defined"**: Expected for AsyncStorage on web builds
- **Module resolution errors**: Check tsconfig.json path aliases
- **Tailwind classes not working**: Verify cn() function usage from lib/utils.ts

NEVER CANCEL long-running build commands. Metro bundler compilation is CPU-intensive and can take several minutes on first run.