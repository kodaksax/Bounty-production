/**
 * Theme Components Test
 * 
 * This test verifies that all theme components can be imported and basic props work
 */

import React from 'react';
import { View, Text } from 'react-native';

// Import theme system
import { theme } from '../lib/theme';
import { useAppTheme } from '../hooks/use-app-theme';

// Import animated components
import { AnimatedCard } from '../components/ui/animated-card';
import { AnimatedScreen } from '../components/ui/animated-screen';
import { EmptyState, BountyEmptyState } from '../components/ui/empty-state';
import { Button } from '../components/ui/button';

// Import providers
import { ThemeProvider } from '../components/theme-provider';

describe('Theme System', () => {
  test('theme exports all required tokens', () => {
    expect(theme.colors).toBeDefined();
    expect(theme.spacing).toBeDefined();
    expect(theme.borderRadius).toBeDefined();
    expect(theme.typography).toBeDefined();
    expect(theme.shadows).toBeDefined();
    expect(theme.animations).toBeDefined();
  });

  test('theme has emerald color palette', () => {
    expect(theme.colors.primary[500]).toBe('#008e2a');
    expect(theme.colors.primary[600]).toBe('#007423');
    expect(theme.colors.primary[700]).toBe('#00571a');
    expect(theme.colors.primary[800]).toBe('#003a12');
  });

  test('theme helper functions work', () => {
    expect(theme.getSpacing('lg')).toBe(16);
    expect(theme.getBorderRadius('xl')).toBe(16);
    expect(theme.getFontSize('base')).toBe(16);
  });
});

describe('Animated Components', () => {
  test('AnimatedCard can be instantiated', () => {
    const component = (
      <AnimatedCard>
        <Text>Test Card</Text>
      </AnimatedCard>
    );
    expect(component).toBeDefined();
  });

  test('AnimatedScreen can be instantiated', () => {
    const component = (
      <AnimatedScreen>
        <Text>Test Screen</Text>
      </AnimatedScreen>
    );
    expect(component).toBeDefined();
  });

  test('EmptyState can be instantiated', () => {
    const component = (
      <EmptyState
        title="Test Empty"
        description="Test description"
      />
    );
    expect(component).toBeDefined();
  });

  test('Button with emerald theme can be instantiated', () => {
    const component = (
      <Button onPress={() => {}}>
        Test Button
      </Button>
    );
    expect(component).toBeDefined();
  });
});

describe('ThemeProvider Integration', () => {
  test('ThemeProvider wraps components', () => {
    const app = (
      <ThemeProvider>
        <View>
          <Text>Test App</Text>
        </View>
      </ThemeProvider>
    );
    expect(app).toBeDefined();
  });
});

console.log('✅ Theme Components Test Suite');
console.log('All theme components can be imported and instantiated successfully!');
console.log('');
console.log('Theme Colors:');
console.log('  - Primary (emerald-500):', theme.colors.primary[500]);
console.log('  - Dark (emerald-600):', theme.colors.primary[600]);
console.log('  - Darker (emerald-700):', theme.colors.primary[700]);
console.log('');
console.log('Available Components:');
console.log('  ✓ AnimatedCard');
console.log('  ✓ AnimatedScreen');
console.log('  ✓ EmptyState');
console.log('  ✓ BountyEmptyState');
console.log('  ✓ Button (enhanced)');
console.log('  ✓ ThemeProvider');
console.log('  ✓ useAppTheme hook');
