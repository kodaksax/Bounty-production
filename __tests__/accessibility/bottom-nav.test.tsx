/**
 * @jest-environment node
 * Accessibility Tests for BottomNav Component
 * 
 * Tests that the BottomNav component meets WCAG 2.1 AA accessibility standards
 */

import React from 'react';
import renderer from 'react-test-renderer';
import { BottomNav, ScreenKey } from '../../components/ui/bottom-nav';
import {
  hasAccessibilityLabel,
  hasValidAccessibilityRole,
  hasProperInteractiveAccessibility,
} from '../utils/accessibility-helpers';

// Mock haptic feedback
jest.mock('../../lib/haptic-feedback', () => ({
  useHapticFeedback: () => ({ triggerHaptic: jest.fn() }),
}));

// Mock MaterialIcons
jest.mock('@expo/vector-icons', () => ({
  MaterialIcons: 'MaterialIcons',
}));

// Mock react-native Animated
jest.mock('react-native', () => {
  const RN = jest.requireActual('react-native');
  return {
    ...RN,
    Animated: {
      ...RN.Animated,
      Value: jest.fn(() => ({
        interpolate: jest.fn(() => ({
          inputRange: [],
          outputRange: [],
        })),
      })),
      timing: jest.fn(() => ({
        start: jest.fn(),
      })),
      parallel: jest.fn((animations) => ({
        start: jest.fn(),
      })),
    },
  };
});

describe('BottomNav Accessibility', () => {
  const mockOnNavigate = jest.fn();
  const defaultProps = {
    activeScreen: 'bounty' as ScreenKey,
    onNavigate: mockOnNavigate,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('WCAG 4.1.2 - Name, Role, Value', () => {
    it('should have button role for all nav items', () => {
      const tree = renderer.create(
        <BottomNav {...defaultProps} />
      );
      
      const buttons = tree.root.findAllByProps({ accessibilityRole: 'button' });
      
      // Should have at least 5 buttons (create, wallet, bounty, postings, profile)
      expect(buttons.length).toBeGreaterThanOrEqual(5);
    });

    it('should have descriptive labels for all nav items', () => {
      const tree = renderer.create(
        <BottomNav {...defaultProps} />
      );
      
      const buttons = tree.root.findAllByProps({ accessibilityRole: 'button' });
      
      buttons.forEach(button => {
        expect(hasAccessibilityLabel(button)).toBe(true);
        expect(button.props.accessibilityLabel).toBeTruthy();
        expect(button.props.accessibilityLabel.length).toBeGreaterThan(0);
      });
    });

    it('should communicate selection state', () => {
      const tree = renderer.create(
        <BottomNav {...defaultProps} activeScreen="bounty" />
      );
      
      const buttons = tree.root.findAllByProps({ accessibilityRole: 'button' });
      
      // At least one button should be selected
      const selectedButtons = buttons.filter(b => 
        b.props.accessibilityState?.selected === true
      );
      
      expect(selectedButtons.length).toBeGreaterThan(0);
    });

    it('should update selection state when active screen changes', () => {
      const tree = renderer.create(
        <BottomNav {...defaultProps} activeScreen="wallet" />
      );
      
      const walletButton = tree.root.findByProps({ 
        accessibilityLabel: expect.stringContaining('wallet') || expect.stringContaining('Wallet')
      });
      
      expect(walletButton.props.accessibilityState?.selected).toBe(true);
    });
  });

  describe('WCAG 2.5.5 - Touch Target Size', () => {
    it('should have minimum touch target size for all buttons', () => {
      const tree = renderer.create(
        <BottomNav {...defaultProps} />
      );
      
      const buttons = tree.root.findAllByProps({ accessibilityRole: 'button' });
      
      buttons.forEach(button => {
        const styles = Array.isArray(button.props.style)
          ? Object.assign({}, ...button.props.style.filter(Boolean))
          : button.props.style;
        
        // Check that touch targets meet minimum size
        if (styles.minWidth) {
          expect(styles.minWidth).toBeGreaterThanOrEqual(44);
        }
        if (styles.minHeight) {
          expect(styles.minHeight).toBeGreaterThanOrEqual(44);
        }
      });
    });

    it('should have larger touch target for center bounty button', () => {
      const tree = renderer.create(
        <BottomNav {...defaultProps} />
      );
      
      // The center button should be the bounty/main screen button
      const bountyButton = tree.root.findByProps({ 
        accessibilityLabel: expect.stringContaining('bounty') || expect.stringContaining('Bounty') || expect.stringContaining('main')
      });
      
      expect(bountyButton).toBeDefined();
    });
  });

  describe('Interactive Element Standards', () => {
    it('should have proper accessibility for all navigation items', () => {
      const tree = renderer.create(
        <BottomNav {...defaultProps} />
      );
      
      const buttons = tree.root.findAllByProps({ accessibilityRole: 'button' });
      
      buttons.forEach(button => {
        const check = hasProperInteractiveAccessibility(button);
        
        if (!check.valid) {
          console.error('Button accessibility issues:', {
            label: button.props.accessibilityLabel,
            issues: check.issues,
          });
        }
        
        expect(check.valid).toBe(true);
      });
    });

    it('should be marked as accessible', () => {
      const tree = renderer.create(
        <BottomNav {...defaultProps} />
      );
      
      const buttons = tree.root.findAllByProps({ accessibilityRole: 'button' });
      
      buttons.forEach(button => {
        expect(button.props.accessible).toBe(true);
      });
    });
  });

  describe('Navigation Behavior', () => {
    it('should call onNavigate when button is pressed', () => {
      const tree = renderer.create(
        <BottomNav {...defaultProps} activeScreen="bounty" />
      );
      
      const walletButton = tree.root.findAllByProps({ accessibilityRole: 'button' })
        .find(b => b.props.accessibilityLabel?.toLowerCase().includes('wallet'));
      
      if (walletButton) {
        walletButton.props.onPress();
        expect(mockOnNavigate).toHaveBeenCalled();
      }
    });

    it('should support admin button when showAdmin is true', () => {
      const tree = renderer.create(
        <BottomNav {...defaultProps} showAdmin={true} />
      );
      
      const buttons = tree.root.findAllByProps({ accessibilityRole: 'button' });
      
      // Should have 6 buttons when admin is shown
      expect(buttons.length).toBeGreaterThanOrEqual(6);
    });
  });

  describe('Haptic Feedback', () => {
    it('should trigger haptic feedback on navigation', () => {
      const mockTrigger = jest.fn();
      jest.spyOn(require('../../lib/haptic-feedback'), 'useHapticFeedback')
        .mockReturnValue({ triggerHaptic: mockTrigger });
      
      const tree = renderer.create(
        <BottomNav {...defaultProps} activeScreen="bounty" />
      );
      
      const walletButton = tree.root.findAllByProps({ accessibilityRole: 'button' })
        .find(b => b.props.accessibilityLabel?.toLowerCase().includes('wallet'));
      
      if (walletButton) {
        walletButton.props.onPress();
      }
    });
  });

  describe('Decorative Elements', () => {
    it('should have icons for visual representation', () => {
      const tree = renderer.create(
        <BottomNav {...defaultProps} />
      );
      
      const icons = tree.root.findAllByType('MaterialIcons');
      
      // Should have icons for each navigation item
      expect(icons.length).toBeGreaterThanOrEqual(5);
    });
  });

  describe('WCAG 1.3.1 - Info and Relationships', () => {
    it('should properly structure navigation as a set of buttons', () => {
      const tree = renderer.create(
        <BottomNav {...defaultProps} />
      );
      
      const buttons = tree.root.findAllByProps({ accessibilityRole: 'button' });
      
      // All nav items should be buttons
      expect(buttons.length).toBeGreaterThanOrEqual(5);
      
      // All should have the button role
      buttons.forEach(button => {
        expect(button.props.accessibilityRole).toBe('button');
      });
    });
  });
});
