// Manual mock for expo-updates used in Jest (Node) environment.
// The real module ships as untransformed ESM and is native-only; tests only
// read `Updates.channel` (via lib/config/env-guard.ts), so a lightweight stub
// is sufficient. Individual tests can still override via jest.mock('expo-updates').
module.exports = {
  channel: null,
  isEnabled: false,
  runtimeVersion: null,
  updateId: null,
  checkForUpdateAsync: async () => ({ isAvailable: false }),
  fetchUpdateAsync: async () => ({ isNew: false }),
  reloadAsync: async () => {},
};
