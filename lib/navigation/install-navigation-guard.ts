/**
 * Side-effect module: guards expo-router's shared `router` object, which is
 * the same object every `useRouter()` call and `import { router }` returns.
 * Imported once, at the top of app/_layout.tsx, so it is in place before any
 * screen can navigate. See navigation-guard.ts for what is guarded and why.
 */
import { router } from 'expo-router';
import { navigationGuard } from './navigation-guard';

navigationGuard.wrapRouter(router);
