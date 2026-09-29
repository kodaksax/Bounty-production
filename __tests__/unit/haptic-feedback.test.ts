import * as Haptics from 'expo-haptics';
import { hapticFeedback } from '../../lib/haptic-feedback';

// Mock expo-haptics
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  selectionAsync: jest.fn(),
  ImpactFeedbackStyle: {
    Light: 'Light',
    Medium: 'Medium',
    Heavy: 'Heavy',
    Soft: 'Soft',
  },
  NotificationFeedbackType: {
    Success: 'Success',
    Warning: 'Warning',
    Error: 'Error',
  },
}));

describe('Haptic Feedback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Impact Feedback', () => {
    it('should trigger light impact feedback', () => {
      hapticFeedback.light();
      expect(Haptics.impactAsync).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Light);
    });

    it('should trigger medium impact feedback', () => {
      hapticFeedback.medium();
      expect(Haptics.impactAsync).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Medium);
    });

    it('should trigger heavy impact feedback', () => {
      hapticFeedback.heavy();
      expect(Haptics.impactAsync).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Heavy);
    });
  });

  describe('Notification Feedback', () => {
    it('should trigger success notification feedback', () => {
      hapticFeedback.success();
      expect(Haptics.notificationAsync).toHaveBeenCalledWith(Haptics.NotificationFeedbackType.Success);
    });

    it('should trigger warning notification feedback', () => {
      hapticFeedback.warning();
      expect(Haptics.notificationAsync).toHaveBeenCalledWith(Haptics.NotificationFeedbackType.Warning);
    });

    it('should trigger error notification feedback', () => {
      hapticFeedback.error();
      expect(Haptics.notificationAsync).toHaveBeenCalledWith(Haptics.NotificationFeedbackType.Error);
    });
  });

  describe('Selection Feedback', () => {
    it('should trigger selection feedback', () => {
      hapticFeedback.selection();
      expect(Haptics.selectionAsync).toHaveBeenCalled();
    });
  });
  describe('Unavailable haptics never break the caller', () => {
    // Where haptics are unsupported (web, some simulators) expo-haptics can
    // reject its promise rather than throw. The profile-save path calls
    // success() right before navigating, so neither mode may escape.
    it('swallows an async rejection', async () => {
      const unhandled = jest.fn();
      process.on('unhandledRejection', unhandled);
      (Haptics.notificationAsync as jest.Mock).mockReturnValueOnce(
        Promise.reject(new Error('Haptics not available'))
      );

      expect(() => hapticFeedback.success()).not.toThrow();
      await new Promise(resolve => setImmediate(resolve));

      process.off('unhandledRejection', unhandled);
      expect(unhandled).not.toHaveBeenCalled();
    });

    it('swallows a synchronous throw', () => {
      (Haptics.notificationAsync as jest.Mock).mockImplementationOnce(() => {
        throw new Error('Haptics not available');
      });
      expect(() => hapticFeedback.success()).not.toThrow();
    });

    it('falls back to a light impact when soft is rejected', async () => {
      (Haptics.impactAsync as jest.Mock).mockReturnValueOnce(Promise.reject(new Error('unsupported')));

      hapticFeedback.soft();
      await new Promise(resolve => setImmediate(resolve));

      expect(Haptics.impactAsync).toHaveBeenNthCalledWith(1, Haptics.ImpactFeedbackStyle.Soft);
      expect(Haptics.impactAsync).toHaveBeenNthCalledWith(2, Haptics.ImpactFeedbackStyle.Light);
    });
  });
});
