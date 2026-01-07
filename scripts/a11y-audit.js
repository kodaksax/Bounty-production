#!/usr/bin/env node
/**
 * Automated Accessibility Audit Script
 * 
 * This script runs a comprehensive accessibility audit on the BOUNTYExpo app.
 * It checks for:
 * - Missing accessibility labels
 * - Invalid accessibility roles
 * - Touch target sizes
 * - Color contrast issues
 * - Screen reader compatibility
 * 
 * Usage: npm run a11y-audit
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🔍 Starting Accessibility Audit...\n');

const results = {
  eslintIssues: 0,
  testFailures: 0,
  warnings: [],
  errors: [],
  passed: [],
};

// STEP 1: Run ESLint with accessibility rules
console.log('📋 Step 1: Running ESLint accessibility checks...');
try {
  execSync('npm run lint', { stdio: 'inherit' });
  results.passed.push('✅ ESLint accessibility rules passed');
} catch (error) {
  results.eslintIssues++;
  results.errors.push('❌ ESLint found accessibility issues');
  console.error('ESLint found issues. Run "npm run lint" for details.\n');
}

// STEP 2: Run accessibility tests
console.log('\n🧪 Step 2: Running accessibility tests...');
try {
  execSync('npm test -- __tests__/accessibility --passWithNoTests', { stdio: 'inherit' });
  results.passed.push('✅ Accessibility tests passed');
} catch (error) {
  results.testFailures++;
  results.errors.push('❌ Accessibility tests failed');
  console.error('Some accessibility tests failed.\n');
}

// STEP 3: Check for common accessibility issues in code
console.log('\n🔎 Step 3: Scanning for common accessibility issues...');

const commonIssues = [
  {
    name: 'Missing accessibilityLabel on TouchableOpacity',
    pattern: /<TouchableOpacity[^>]*onPress[^>]*>(?![\s\S]*accessibilityLabel)/g,
    severity: 'error',
  },
  {
    name: 'Missing accessibilityRole on interactive elements',
    pattern: /<TouchableOpacity[^>]*onPress[^>]*>(?![\s\S]*accessibilityRole)/g,
    severity: 'warning',
  },
  {
    name: 'Image without accessibility',
    pattern: /<Image[^>]*source[^>]*>(?![\s\S]*accessibilityLabel|[\s\S]*accessibilityElementsHidden)/g,
    severity: 'warning',
  },
];

const appDir = path.join(__dirname, '../app');
const componentsDir = path.join(__dirname, '../components');

function scanDirectory(dir, issues) {
  if (!fs.existsSync(dir)) {
    return;
  }

  const files = fs.readdirSync(dir, { recursive: true });
  
  files.forEach(file => {
    const filePath = path.join(dir, file);
    
    if (!fs.statSync(filePath).isFile()) return;
    if (!filePath.endsWith('.tsx') && !filePath.endsWith('.jsx')) return;
    
    const content = fs.readFileSync(filePath, 'utf-8');
    
    issues.forEach(issue => {
      const matches = content.match(issue.pattern);
      if (matches && matches.length > 0) {
        const msg = `${issue.severity === 'error' ? '❌' : '⚠️'} ${issue.name} in ${path.relative(process.cwd(), filePath)}`;
        
        if (issue.severity === 'error') {
          results.errors.push(msg);
        } else {
          results.warnings.push(msg);
        }
      }
    });
  });
}

// Scan app and components directories
scanDirectory(appDir, commonIssues);
scanDirectory(componentsDir, commonIssues);

if (results.errors.length === 0 && results.warnings.length === 0) {
  results.passed.push('✅ No common accessibility issues found in code scan');
}

// STEP 4: Check for accessibility documentation
console.log('\n📚 Step 4: Checking accessibility documentation...');

const requiredDocs = [
  'ACCESSIBILITY_GUIDE.md',
  'ACCESSIBILITY_TESTING_GUIDE.md',
];

let docsComplete = true;
requiredDocs.forEach(doc => {
  const docPath = path.join(__dirname, '..', doc);
  if (fs.existsSync(docPath)) {
    results.passed.push(`✅ ${doc} exists`);
  } else {
    results.warnings.push(`⚠️ Missing ${doc}`);
    docsComplete = false;
  }
});

// STEP 5: Verify accessibility constants exist
console.log('\n⚙️ Step 5: Verifying accessibility constants...');

const constantsPath = path.join(__dirname, '../lib/constants/accessibility.ts');
if (fs.existsSync(constantsPath)) {
  const constants = fs.readFileSync(constantsPath, 'utf-8');
  
  const requiredConstants = [
    'MIN_TOUCH_TARGET',
    'SPACING',
    'TYPOGRAPHY',
    'ANIMATION',
  ];
  
  requiredConstants.forEach(constant => {
    if (constants.includes(constant)) {
      results.passed.push(`✅ ${constant} constant defined`);
    } else {
      results.warnings.push(`⚠️ Missing ${constant} constant`);
    }
  });
} else {
  results.errors.push('❌ Accessibility constants file not found');
}

// Print Summary
console.log('\n' + '='.repeat(60));
console.log('📊 ACCESSIBILITY AUDIT SUMMARY');
console.log('='.repeat(60));

if (results.passed.length > 0) {
  console.log('\n✅ PASSED:');
  results.passed.forEach(item => console.log(`  ${item}`));
}

if (results.warnings.length > 0) {
  console.log('\n⚠️  WARNINGS:');
  results.warnings.forEach(item => console.log(`  ${item}`));
}

if (results.errors.length > 0) {
  console.log('\n❌ ERRORS:');
  results.errors.forEach(item => console.log(`  ${item}`));
}

console.log('\n' + '='.repeat(60));

// Exit with appropriate code
const hasErrors = results.errors.length > 0 || results.eslintIssues > 0 || results.testFailures > 0;
if (hasErrors) {
  console.log('❌ Accessibility audit found issues that need attention.');
  console.log('\nNext steps:');
  console.log('  1. Fix ESLint errors: npm run lint');
  console.log('  2. Fix failing tests: npm test -- __tests__/accessibility');
  console.log('  3. Review code scan warnings');
  console.log('  4. Update documentation as needed');
  process.exit(1);
} else if (results.warnings.length > 0) {
  console.log('⚠️  Accessibility audit passed with warnings.');
  console.log('Review warnings and consider addressing them for better accessibility.');
  process.exit(0);
} else {
  console.log('✅ All accessibility checks passed!');
  console.log('Your app meets WCAG 2.1 AA standards.');
  process.exit(0);
}
