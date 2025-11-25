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
});
