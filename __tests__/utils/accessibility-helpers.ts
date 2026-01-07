/**
 * Accessibility Testing Utilities
 * 
 * Helpers for automated accessibility testing in React Native components.
 * These utilities help ensure components meet WCAG 2.1 AA standards.
 */

import { ReactTestInstance } from 'react-test-renderer';

/**
 * Check if an element has required accessibility props
 */
export function hasAccessibilityLabel(element: ReactTestInstance): boolean {
  return !!(
    element.props.accessibilityLabel ||
    (typeof element.children?.[0] === 'string' && element.children[0])
  );
}

/**
 * Check if an element has a valid accessibility role
 */
export function hasValidAccessibilityRole(element: ReactTestInstance): boolean {
  const validRoles = [
    'button',
    'link',
    'search',
    'image',
    'keyboardkey',
    'text',
    'adjustable',
    'imagebutton',
    'header',
    'summary',
    'alert',
    'checkbox',
    'combobox',
    'menu',
    'menubar',
    'menuitem',
    'progressbar',
    'radio',
    'radiogroup',
    'scrollbar',
    'spinbutton',
    'switch',
    'tab',
    'tablist',
    'timer',
    'toolbar',
    'none', // Valid but means element is not accessible
  ];
  
  const role = element.props.accessibilityRole;
  return !role || validRoles.includes(role);
}

/**
 * Check if an interactive element (button, link, etc.) has proper accessibility setup
 */
export function hasProperInteractiveAccessibility(element: ReactTestInstance): {
  valid: boolean;
  issues: string[];
} {
  const issues: string[] = [];
  
  // Check for accessibility label
  if (!hasAccessibilityLabel(element)) {
    issues.push('Missing accessibilityLabel');
  }
  
  // Check for valid role
  if (!hasValidAccessibilityRole(element)) {
    issues.push(`Invalid accessibilityRole: ${element.props.accessibilityRole}`);
  }
  
  // For buttons, check if role is set
  const hasPressHandler = element.props.onPress;
  if (hasPressHandler && !element.props.accessibilityRole) {
    issues.push('Interactive element missing accessibilityRole');
  }
  
  return {
    valid: issues.length === 0,
    issues,
  };
}

/**
 * Check if element has appropriate touch target size
 * WCAG 2.5.5 requires minimum 44x44 points
 */
export function hasSufficientTouchTarget(element: ReactTestInstance): {
  valid: boolean;
  issues: string[];
} {
  const MIN_SIZE = 44;
  const issues: string[] = [];
  
  const style = element.props.style;
  if (!style) {
    issues.push('No style defined - cannot verify touch target size');
    return { valid: false, issues };
  }
  
  // Flatten style array if necessary
  const flatStyle = Array.isArray(style) 
    ? Object.assign({}, ...style.filter(Boolean))
    : style;
  
  const width = flatStyle.width || flatStyle.minWidth;
  const height = flatStyle.height || flatStyle.minHeight;
  
  if (width && width < MIN_SIZE) {
    issues.push(`Width ${width} is less than minimum ${MIN_SIZE}`);
  }
  
  if (height && height < MIN_SIZE) {
    issues.push(`Height ${height} is less than minimum ${MIN_SIZE}`);
  }
  
  return {
    valid: issues.length === 0,
    issues,
  };
}

/**
 * Check if decorative images/icons are properly hidden from screen readers
 */
export function isDecorativeElementProperlyHidden(element: ReactTestInstance): boolean {
  // Decorative elements should have accessibilityElementsHidden or importantForAccessibility="no"
  return !!(
    element.props.accessibilityElementsHidden === true ||
    element.props.importantForAccessibility === 'no' ||
    element.props.importantForAccessibility === 'no-hide-descendants'
  );
}

/**
 * Get all accessibility issues for an element and its children
 */
export function getAccessibilityIssues(
  element: ReactTestInstance,
  options: {
    checkTouchTargets?: boolean;
    checkLabels?: boolean;
    checkRoles?: boolean;
    checkDecorativeElements?: boolean;
  } = {}
): string[] {
  const {
    checkTouchTargets = true,
    checkLabels = true,
    checkRoles = true,
    checkDecorativeElements = true,
  } = options;
  
  const issues: string[] = [];
  const elementType = element.type;
  
  // Check interactive elements
  const isInteractive = element.props.onPress || element.props.onLongPress;
  if (isInteractive) {
    if (checkLabels || checkRoles) {
      const interactiveCheck = hasProperInteractiveAccessibility(element);
      if (!interactiveCheck.valid) {
        issues.push(...interactiveCheck.issues.map(issue => 
          `${elementType}: ${issue}`
        ));
      }
    }
    
    if (checkTouchTargets) {
      const touchTargetCheck = hasSufficientTouchTarget(element);
      if (!touchTargetCheck.valid) {
        issues.push(...touchTargetCheck.issues.map(issue => 
          `${elementType}: ${issue}`
        ));
      }
    }
  }
  
  // Check decorative elements (icons, images without onPress)
  if (checkDecorativeElements) {
    const isIcon = typeof elementType === 'string' && 
      (elementType.includes('Icon') || elementType.includes('Image'));
    
    if (isIcon && !isInteractive && !isDecorativeElementProperlyHidden(element)) {
      issues.push(`${elementType}: Decorative element not hidden from screen readers`);
    }
  }
  
  return issues;
}

/**
 * Test if a component tree meets accessibility standards
 */
export function testAccessibility(
  root: ReactTestInstance,
  componentName: string = 'Component'
): {
  passed: boolean;
  issues: string[];
  warnings: string[];
} {
  const issues: string[] = [];
  const warnings: string[] = [];
  
  try {
    // Find all potentially problematic elements
    const allElements = root.findAll(() => true);
    
    allElements.forEach(element => {
      const elementIssues = getAccessibilityIssues(element);
      issues.push(...elementIssues);
    });
    
    // Check for overall component accessibility
    if (allElements.length === 0) {
      warnings.push(`${componentName}: No elements found for accessibility testing`);
    }
    
  } catch (error) {
    issues.push(`${componentName}: Error during accessibility testing - ${error}`);
  }
  
  return {
    passed: issues.length === 0,
    issues,
    warnings,
  };
}

/**
 * Assert that a component meets accessibility standards
 * Throws if issues are found
 */
export function assertAccessibility(
  root: ReactTestInstance,
  componentName: string = 'Component'
): void {
  const result = testAccessibility(root, componentName);
  
  if (!result.passed) {
    const message = [
      `Accessibility issues found in ${componentName}:`,
      ...result.issues.map(issue => `  - ${issue}`),
      result.warnings.length > 0 ? '\nWarnings:' : '',
      ...result.warnings.map(warning => `  - ${warning}`),
    ].filter(Boolean).join('\n');
    
    throw new Error(message);
  }
}
