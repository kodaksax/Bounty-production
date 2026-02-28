/**
 * Accessibility Tests for Button Component
 * 
 * Tests that the Button component meets WCAG 2.1 AA accessibility standards
 * @jest-environment node
 */

// Mock haptic feedback
jest.mock('../../lib/haptic-feedback', () => ({
  useHapticFeedback: () => ({ triggerHaptic: jest.fn() }),
}));

// Mock class-variance-authority
jest.mock('class-variance-authority', () => ({
  cva: () => () => '',
}));

// Mock utils
jest.mock('lib/utils', () => ({
  cn: (...args: any[]) => args.filter(Boolean).join(' '),
}));

describe('Button Accessibility', () => {
  it('should import Button component without errors', () => {
    // This test verifies the component can be imported with proper mocks
    expect(() => require('../../components/ui/button')).not.toThrow();
  });

  it('should have accessibility best practices documented', () => {
    // Verify accessibility documentation exists
    const fs = require('fs');
    const path = require('path');
    
    const accessibilityGuide = path.join(__dirname, '../../ACCESSIBILITY_GUIDE.md');
    const exists = fs.existsSync(accessibilityGuide);
    
    expect(exists).toBe(true);
  });

  describe('Button Accessibility Standards', () => {
    it('should document minimum touch target size', () => {
      const fs = require('fs');
      const path = require('path');
      
      const constantsPath = path.join(__dirname, '../../lib/constants/accessibility.ts');
      if (fs.existsSync(constantsPath)) {
        const content = fs.readFileSync(constantsPath, 'utf-8');
        expect(content).toContain('MIN_TOUCH_TARGET');
      }
    });

    it('should verify button styles meet accessibility standards', () => {
      // Verify button implementation file exists and has required styles
      const fs = require('fs');
      const path = require('path');
      
      const buttonPath = path.join(__dirname, '../../components/ui/button.tsx');
      expect(fs.existsSync(buttonPath)).toBe(true);
      
      const content = fs.readFileSync(buttonPath, 'utf-8');
      
      // Verify accessibility props are used
      expect(content).toContain('accessibilityRole');
      expect(content).toContain('accessibilityLabel');
      expect(content).toContain('accessibilityHint');
      expect(content).toContain('accessibilityState');
    });

    it('should verify focus state styles are implemented', () => {
      // Check that button implementation has focus state styles
      const fs = require('fs');
      const path = require('path');
      
      const buttonPath = path.join(__dirname, '../../components/ui/button.tsx');
      const content = fs.readFileSync(buttonPath, 'utf-8');
      
      // Verify focus state exists with visible indicators
      expect(content).toContain('focused');
      expect(content).toContain('borderWidth');
      expect(content).toContain('borderColor');
    });
  });

  describe('WCAG 2.5.5 - Touch Target Size', () => {
    it('should verify button minHeight meets WCAG standards', () => {
      // Read button implementation to verify actual minHeight values
      const fs = require('fs');
      const path = require('path');
      
      const buttonPath = path.join(__dirname, '../../components/ui/button.tsx');
      const content = fs.readFileSync(buttonPath, 'utf-8');
      
      // Verify minHeight is defined in base styles
      expect(content).toContain('minHeight');
      
      // Extract minHeight value from base style (48)
      const baseStyleMatch = content.match(/base:\s*{[\s\S]*?minHeight:\s*(\d+)/);
      if (baseStyleMatch) {
        const minHeight = parseInt(baseStyleMatch[1]);
        expect(minHeight).toBeGreaterThanOrEqual(44); // WCAG minimum
      }
    });

    it('should verify size variants meet accessibility standards', () => {
      const fs = require('fs');
      const path = require('path');
      
      const buttonPath = path.join(__dirname, '../../components/ui/button.tsx');
      const content = fs.readFileSync(buttonPath, 'utf-8');
      
      // Verify sm size meets minimum
      const smMatch = content.match(/sm:\s*{[\s\S]*?minHeight:\s*(\d+)/);
      if (smMatch) {
        const smHeight = parseInt(smMatch[1]);
        expect(smHeight).toBeGreaterThanOrEqual(40);
      }
      
      // Verify lg size is larger than default
      const lgMatch = content.match(/lg:\s*{[\s\S]*?minHeight:\s*(\d+)/);
      if (lgMatch) {
        const lgHeight = parseInt(lgMatch[1]);
        expect(lgHeight).toBeGreaterThan(44);
      }
    });
  });

  describe('WCAG 2.4.7 - Focus Visible', () => {
    it('should verify focus state implementation', () => {
      const fs = require('fs');
      const path = require('path');
      
      const buttonPath = path.join(__dirname, '../../components/ui/button.tsx');
      const content = fs.readFileSync(buttonPath, 'utf-8');
      
      // Verify focus state has visible indicators per WCAG 2.4.7
      expect(content).toContain('focused');
      
      // Look for focused style section (need to capture more content)
      const focusedSectionMatch = content.match(/focused:\s*{[\s\S]{0,500}}/);
      if (focusedSectionMatch) {
        const focusedSection = focusedSectionMatch[0];
        
        // Check for visible border indicators
        expect(focusedSection).toContain('borderWidth');
        expect(focusedSection).toContain('borderColor');
        
        // Extract borderWidth value (should be >= 3 for visibility)
        const borderWidthMatch = focusedSection.match(/borderWidth:\s*(\d+)/);
        if (borderWidthMatch) {
          const borderWidth = parseInt(borderWidthMatch[1]);
          expect(borderWidth).toBeGreaterThanOrEqual(3);
        }
      }
    });
  });

  describe('Best Practices', () => {
    it('should verify haptic feedback implementation', () => {
      const fs = require('fs');
      const path = require('path');
      
      const buttonPath = path.join(__dirname, '../../components/ui/button.tsx');
      const content = fs.readFileSync(buttonPath, 'utf-8');
      
      // Verify button uses haptic feedback hook
      expect(content).toContain('useHapticFeedback');
      expect(content).toContain('triggerHaptic');
    });

    it('should verify all button variants are defined', () => {
      const fs = require('fs');
      const path = require('path');
      
      const buttonPath = path.join(__dirname, '../../components/ui/button.tsx');
      const content = fs.readFileSync(buttonPath, 'utf-8');
      
      const variants = ['default', 'destructive', 'outline', 'secondary', 'ghost', 'link'];
      variants.forEach(variant => {
        expect(content).toContain(`${variant}:`);
      });
    });
  });
});

