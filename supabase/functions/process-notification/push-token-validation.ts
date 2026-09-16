// Helper that decides whether a stored push token has a shape the Expo Push
// API will accept. A token with any other shape makes Expo reject the whole
// HTTP request for the chunk it sits in, so every co-batched recipient fails
// and no token is pruned. The delivery worker filters tokens through this
// guard before it builds a send chunk.
//
// Pure and dependency-free for unit testing; also inlined into index.ts
// because the Supabase Edge bundler does not support local imports.

// A bare UUID is the legacy raw device-token form that Expo still accepts
// alongside the ExponentPushToken[...] / ExpoPushToken[...] forms.
const RAW_DEVICE_TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Return true when `token` is a shape the Expo Push API accepts: an
 * `ExponentPushToken[...]` / `ExpoPushToken[...]` value or a legacy raw device
 * token. Mirrors the acceptance rule of expo-server-sdk's `isExpoPushToken`,
 * so a valid token is never dropped.
 */
export function isValidExpoPushToken(token: unknown): boolean {
  if (typeof token !== 'string') return false;
  const t = token.trim();
  if ((t.startsWith('ExponentPushToken[') || t.startsWith('ExpoPushToken[')) && t.endsWith(']')) {
    return true;
  }
  return RAW_DEVICE_TOKEN.test(t);
}

export default isValidExpoPushToken;
