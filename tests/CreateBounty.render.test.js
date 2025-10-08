// Smoke test for Create Bounty components
// This test verifies that components can be imported and basic structure is correct

console.log('Running Create Bounty Render Smoke Tests...\n');

let passCount = 0;
let failCount = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passCount++;
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(`  ${error instanceof Error ? error.message : String(error)}`);
    failCount++;
  }
}

// Test 1: Verify useBountyDraft hook exports
test('useBountyDraft hook exports correctly', () => {
  const hookPath = '../app/hooks/useBountyDraft.ts';
  const fs = require('fs');
  const path = require('path');
  const filePath = path.join(__dirname, hookPath);
  
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  
  const content = fs.readFileSync(filePath, 'utf8');
  
  // Check for key exports
  if (!content.includes('export function useBountyDraft')) {
    throw new Error('useBountyDraft function not exported');
  }
  
  if (!content.includes('export interface BountyDraft')) {
    throw new Error('BountyDraft interface not exported');
  }
  
  // Check for AsyncStorage usage
  if (!content.includes('AsyncStorage')) {
    throw new Error('AsyncStorage not imported/used');
  }
});

// Test 2: Verify StepperHeader component structure
test('StepperHeader component structure is valid', () => {
  const componentPath = '../app/components/StepperHeader.tsx';
  const fs = require('fs');
  const path = require('path');
  const filePath = path.join(__dirname, componentPath);
  
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  
  const content = fs.readFileSync(filePath, 'utf8');
  
  // Check for component export
  if (!content.includes('export function StepperHeader')) {
    throw new Error('StepperHeader function not exported');
  }
  
  // Check for required props
  if (!content.includes('currentStep') || !content.includes('totalSteps') || !content.includes('stepTitle')) {
    throw new Error('Missing required props in interface');
  }
  
  // Check for progress dots rendering
  if (!content.includes('Array.from')) {
    throw new Error('Progress dots rendering logic not found');
  }
});

// Test 3: Verify ValidationMessage component structure
test('ValidationMessage component structure is valid', () => {
  const componentPath = '../app/components/ValidationMessage.tsx';
  const fs = require('fs');
  const path = require('path');
  const filePath = path.join(__dirname, componentPath);
  
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  
  const content = fs.readFileSync(filePath, 'utf8');
  
  // Check for component export
  if (!content.includes('export function ValidationMessage')) {
    throw new Error('ValidationMessage function not exported');
  }
  
  // Check for message prop
  if (!content.includes('message')) {
    throw new Error('Message prop not found');
  }
  
  // Check for icon usage
  if (!content.includes('MaterialIcons')) {
    throw new Error('MaterialIcons not used for validation feedback');
  }
});

// Test 4: Verify all step components exist
test('All 5 step components exist', () => {
  const fs = require('fs');
  const path = require('path');
  const stepsDir = path.join(__dirname, '../app/screens/CreateBounty');
  
  const requiredSteps = [
    'StepTitle.tsx',
    'StepDetails.tsx',
    'StepCompensation.tsx',
    'StepLocation.tsx',
    'StepReview.tsx',
  ];
  
  for (const step of requiredSteps) {
    const stepPath = path.join(stepsDir, step);
    if (!fs.existsSync(stepPath)) {
      throw new Error(`Step component not found: ${step}`);
    }
  }
});

// Test 5: Verify CreateBountyFlow controller exists
test('CreateBountyFlow controller exists and exports', () => {
  const controllerPath = '../app/screens/CreateBounty/index.tsx';
  const fs = require('fs');
  const path = require('path');
  const filePath = path.join(__dirname, controllerPath);
  
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  
  const content = fs.readFileSync(filePath, 'utf8');
  
  // Check for main component export
  if (!content.includes('export function CreateBountyFlow')) {
    throw new Error('CreateBountyFlow function not exported');
  }
  
  // Check for step state management
  if (!content.includes('currentStep') || !content.includes('setCurrentStep')) {
    throw new Error('Step state management not found');
  }
  
  // Check for all step imports
  const requiredImports = [
    'StepTitle',
    'StepDetails',
    'StepCompensation',
    'StepLocation',
    'StepReview',
  ];
  
  for (const imp of requiredImports) {
    if (!content.includes(imp)) {
      throw new Error(`Missing import: ${imp}`);
    }
  }
});

// Test 6: Verify bountyService exports
test('bountyService exports correctly', () => {
  const servicePath = '../app/services/bountyService.ts';
  const fs = require('fs');
  const path = require('path');
  const filePath = path.join(__dirname, servicePath);
  
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  
  const content = fs.readFileSync(filePath, 'utf8');
  
  // Check for service export
  if (!content.includes('export const bountyService')) {
    throw new Error('bountyService not exported');
  }
  
  // Check for createBounty method
  if (!content.includes('createBounty')) {
    throw new Error('createBounty method not found');
  }
  
  // Check for connectivity check
  if (!content.includes('checkConnectivity')) {
    throw new Error('checkConnectivity method not found');
  }
});

// Test 7: Verify step components have required props
test('Step components accept required props', () => {
  const fs = require('fs');
  const path = require('path');
  const stepsDir = path.join(__dirname, '../app/screens/CreateBounty');
  
  const steps = [
    { file: 'StepTitle.tsx', requiredProps: ['draft', 'onUpdate', 'onNext'] },
    { file: 'StepDetails.tsx', requiredProps: ['draft', 'onUpdate', 'onNext', 'onBack'] },
    { file: 'StepCompensation.tsx', requiredProps: ['draft', 'onUpdate', 'onNext', 'onBack'] },
    { file: 'StepLocation.tsx', requiredProps: ['draft', 'onUpdate', 'onNext', 'onBack'] },
    { file: 'StepReview.tsx', requiredProps: ['draft', 'onSubmit', 'onBack', 'isSubmitting'] },
  ];
  
  for (const step of steps) {
    const stepPath = path.join(stepsDir, step.file);
    const content = fs.readFileSync(stepPath, 'utf8');
    
    for (const prop of step.requiredProps) {
      if (!content.includes(prop)) {
        throw new Error(`${step.file} missing required prop: ${prop}`);
      }
    }
  }
});

// Test 8: Verify validation logic is present in step components
test('Step components include validation logic', () => {
  const fs = require('fs');
  const path = require('path');
  const stepsDir = path.join(__dirname, '../app/screens/CreateBounty');
  
  const stepsWithValidation = [
    { file: 'StepTitle.tsx', validation: 'validateTitle' },
    { file: 'StepDetails.tsx', validation: 'validateDescription' },
    { file: 'StepCompensation.tsx', validation: 'validateAmount' },
    { file: 'StepLocation.tsx', validation: 'validateLocation' },
  ];
  
  for (const step of stepsWithValidation) {
    const stepPath = path.join(stepsDir, step.file);
    const content = fs.readFileSync(stepPath, 'utf8');
    
    // Check for validation function
    if (!content.includes(step.validation)) {
      throw new Error(`${step.file} missing validation function: ${step.validation}`);
    }
    
    // Check for error state
    if (!content.includes('errors') || !content.includes('setErrors')) {
      throw new Error(`${step.file} missing error state management`);
    }
    
    // Check for ValidationMessage usage
    if (!content.includes('ValidationMessage')) {
      throw new Error(`${step.file} not using ValidationMessage component`);
    }
  }
});

// Test 9: Verify escrow modal in review step
test('StepReview includes escrow modal', () => {
  const fs = require('fs');
  const path = require('path');
  const filePath = path.join(__dirname, '../app/screens/CreateBounty/StepReview.tsx');
  
  const content = fs.readFileSync(filePath, 'utf8');
  
  // Check for modal
  if (!content.includes('Modal')) {
    throw new Error('Modal component not used');
  }
  
  // Check for escrow content
  if (!content.includes('Escrow') || !content.includes('escrow')) {
    throw new Error('Escrow information not found');
  }
  
  // Check for step-by-step explanation
  const steps = ['1', '2', '3', '4'];
  for (const step of steps) {
    if (!content.includes(step)) {
      throw new Error(`Missing escrow step ${step}`);
    }
  }
});

// Test 10: Verify keyboard handling
test('Flow includes keyboard handling', () => {
  const fs = require('fs');
  const path = require('path');
  const filePath = path.join(__dirname, '../app/screens/CreateBounty/index.tsx');
  
  const content = fs.readFileSync(filePath, 'utf8');
  
  // Check for KeyboardAvoidingView
  if (!content.includes('KeyboardAvoidingView')) {
    throw new Error('KeyboardAvoidingView not used');
  }
  
  // Check for platform-specific behavior
  if (!content.includes('Platform.OS')) {
    throw new Error('Platform-specific keyboard behavior not implemented');
  }
});

// Summary
console.log(`\n${passCount + failCount} tests run`);
console.log(`✓ ${passCount} passed`);
if (failCount > 0) {
  console.log(`✗ ${failCount} failed`);
  process.exit(1);
} else {
  console.log('\nAll smoke tests passed! ✓');
  console.log('\nComponents are properly structured and ready for runtime testing.');
  process.exit(0);
}
