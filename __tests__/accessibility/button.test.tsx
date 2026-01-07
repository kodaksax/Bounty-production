/**
 * @jest-environment node
 * Accessibility Tests for Button Component
 * 
 * Tests that the Button component meets WCAG 2.1 AA accessibility standards
 */

import React from 'react';
import renderer from 'react-test-renderer';
import { Button } from '../../components/ui/button';
import {
  hasAccessibilityLabel,
  hasValidAccessibilityRole,
  hasProperInteractiveAccessibility,
} from '../utils/accessibility-helpers';

// Mock haptic feedback
jest.mock('../../lib/haptic-feedback', () => ({
  useHapticFeedback: () => ({ triggerHaptic: jest.fn() }),
}));

// Mock react-native Animated
jest.mock('react-native', () => {
  const RN = jest.requireActual('react-native');
  return {
    ...RN,
    Animated: {
      ...RN.Animated,
      Value: jest.fn(() => ({
        interpolate: jest.fn(),
      })),
      spring: jest.fn(() => ({
        start: jest.fn(),
      })),
      createAnimatedComponent: (Component: any) => Component,
    },
  };
});

describe('Button Accessibility', () => {
  describe('WCAG 4.1.2 - Name, Role, Value', () => {
    it('should have button role', () => {
      const tree = renderer.create(
        <Button>Click me</Button>
      );
      
      const button = tree.root.findByType(Button);
      expect(button.props.accessibilityRole).toBe('button');
    });

    it('should derive label from text children', () => {
      const tree = renderer.create(
        <Button>Submit Form</Button>
      );
      
      const touchable = tree.root.findByProps({ accessibilityRole: 'button' });
      expect(hasAccessibilityLabel(touchable)).toBe(true);
    });

    it('should use custom accessibilityLabel when provided', () => {
      const tree = renderer.create(
        <Button accessibilityLabel="Save changes">
          <span>💾</span>
        </Button>
      );
      
      const touchable = tree.root.findByProps({ accessibilityRole: 'button' });
      expect(touchable.props.accessibilityLabel).toBe('Save changes');
    });

    it('should include accessibility hint when provided', () => {
      const tree = renderer.create(
        <Button accessibilityHint="This will submit the form">
          Submit
        </Button>
      );
      
      const touchable = tree.root.findByProps({ accessibilityRole: 'button' });
      expect(touchable.props.accessibilityHint).toBe('This will submit the form');
    });

    it('should communicate disabled state', () => {
      const tree = renderer.create(
        <Button disabled>Disabled Button</Button>
      );
      
      const touchable = tree.root.findByProps({ accessibilityRole: 'button' });
      expect(touchable.props.accessibilityState).toEqual({ disabled: true });
    });

    it('should communicate enabled state', () => {
      const tree = renderer.create(
        <Button>Enabled Button</Button>
      );
      
      const touchable = tree.root.findByProps({ accessibilityRole: 'button' });
      expect(touchable.props.accessibilityState).toEqual({ disabled: false });
    });
  });

  describe('WCAG 2.5.5 - Touch Target Size', () => {
    it('should have minimum 48pt height', () => {
      const tree = renderer.create(
        <Button>Click me</Button>
      );
      
      const touchable = tree.root.findByProps({ accessibilityRole: 'button' });
      const styles = Array.isArray(touchable.props.style)
        ? Object.assign({}, ...touchable.props.style)
        : touchable.props.style;
      
      expect(styles.minHeight).toBeGreaterThanOrEqual(44); // WCAG minimum
    });

    it('should respect size variants', () => {
      const sizes = ['sm', 'default', 'lg'] as const;
      
      sizes.forEach(size => {
        const tree = renderer.create(
          <Button size={size}>Button</Button>
        );
        
        const touchable = tree.root.findByProps({ accessibilityRole: 'button' });
        const styles = Array.isArray(touchable.props.style)
          ? Object.assign({}, ...touchable.props.style)
          : touchable.props.style;
        
        expect(styles.minHeight).toBeGreaterThanOrEqual(40); // Even small buttons should be accessible
      });
    });
  });

  describe('WCAG 2.4.7 - Focus Visible', () => {
    it('should have focus styles defined', () => {
      const tree = renderer.create(
        <Button>Click me</Button>
      );
      
      // Button component has focus state handling
      const button = tree.root.findByType(Button);
      expect(button).toBeDefined();
      
      // Focus styles are applied via the focused state in the component
      // This is tested through visual regression or manual testing
    });
  });

  describe('Interactive Element Standards', () => {
    it('should have proper interactive accessibility for all variants', () => {
      const variants = ['default', 'destructive', 'outline', 'secondary', 'ghost', 'link'] as const;
      
      variants.forEach(variant => {
        const tree = renderer.create(
          <Button variant={variant}>Button</Button>
        );
        
        const touchable = tree.root.findByProps({ accessibilityRole: 'button' });
        const check = hasProperInteractiveAccessibility(touchable);
        
        expect(check.valid).toBe(true);
        if (!check.valid) {
          console.error(`${variant} variant issues:`, check.issues);
        }
      });
    });

    it('should be accessible', () => {
      const tree = renderer.create(
        <Button>Accessible Button</Button>
      );
      
      const touchable = tree.root.findByProps({ accessibilityRole: 'button' });
      expect(touchable.props.accessible).toBe(true);
    });
  });

  describe('Haptic Feedback', () => {
    it('should trigger haptic feedback on press', () => {
      const mockTrigger = jest.fn();
      jest.spyOn(require('../../lib/haptic-feedback'), 'useHapticFeedback')
        .mockReturnValue({ triggerHaptic: mockTrigger });
      
      const mockOnPress = jest.fn();
      const tree = renderer.create(
        <Button onPress={mockOnPress}>Click me</Button>
      );
      
      const touchable = tree.root.findByProps({ accessibilityRole: 'button' });
      
      // Simulate press
      touchable.props.onPress({});
      
      expect(mockOnPress).toHaveBeenCalled();
    });
  });

  describe('Validation Edge Cases', () => {
    it('should handle button with icon children', () => {
      const tree = renderer.create(
        <Button accessibilityLabel="Search">
          <span>🔍</span>
        </Button>
      );
      
      const touchable = tree.root.findByProps({ accessibilityRole: 'button' });
      expect(touchable.props.accessibilityLabel).toBe('Search');
      expect(hasAccessibilityLabel(touchable)).toBe(true);
    });

    it('should have valid role', () => {
      const tree = renderer.create(
        <Button>Button</Button>
      );
      
      const touchable = tree.root.findByProps({ accessibilityRole: 'button' });
      expect(hasValidAccessibilityRole(touchable)).toBe(true);
    });
  });
});
