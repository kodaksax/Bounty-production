import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getRestorableLastScreen,
  LAST_SCREEN_TTL_MS,
  saveLastScreen,
} from '../../../lib/storage/last-screen';

const stored = (value: unknown) =>
  (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify(value));

describe('last-screen storage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('saves per user with a timestamp', async () => {
    await saveLastScreen('user-1', 'wallet');
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      '@bounty_last_screen:user-1',
      expect.stringContaining('"screen":"wallet"')
    );
  });

  it('restores a recently left tab', async () => {
    stored({ screen: 'wallet', at: Date.now() - 60_000 });
    await expect(getRestorableLastScreen('user-1')).resolves.toBe('wallet');
    expect(AsyncStorage.getItem).toHaveBeenCalledWith('@bounty_last_screen:user-1');
  });

  it('falls back to the feed after the restore window', async () => {
    stored({ screen: 'wallet', at: Date.now() - LAST_SCREEN_TTL_MS - 1 });
    await expect(getRestorableLastScreen('user-1')).resolves.toBeNull();
  });

  it.each(['bounty', 'admin', 'not-a-tab', 42])('does not restore %p', async screen => {
    stored({ screen, at: Date.now() });
    await expect(getRestorableLastScreen('user-1')).resolves.toBeNull();
  });

  it('returns null for missing or corrupted data', async () => {
    await expect(getRestorableLastScreen('user-1')).resolves.toBeNull();
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce('{not json');
    await expect(getRestorableLastScreen('user-1')).resolves.toBeNull();
    (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error('storage down'));
    await expect(getRestorableLastScreen('user-1')).resolves.toBeNull();
  });

  it('gives up on a hung storage read instead of holding the launch', async () => {
    jest.useFakeTimers();
    try {
      (AsyncStorage.getItem as jest.Mock).mockReturnValueOnce(new Promise(() => {}));
      const result = getRestorableLastScreen('user-1', 500);
      jest.advanceTimersByTime(500);
      await expect(result).resolves.toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});
