# Multi-Step Create Bounty Flow

A comprehensive, user-friendly bounty creation experience designed to increase posting conversion rates.

## Overview

The multi-step Create Bounty flow guides users through a 5-step process to create a bounty, with inline validation, draft persistence, and escrow information.

## Features

### Core Features
- **5-Step Guided Process**: Breaks down bounty creation into manageable steps
- **Draft Persistence**: Automatically saves progress to AsyncStorage
- **Inline Validation**: Real-time validation with helpful error messages
- **Escrow Protection Modal**: Clear explanation of payment protection
- **Keyboard-Aware**: Proper handling of keyboard on mobile devices
- **Accessibility**: All inputs have proper accessibility labels

### Step-by-Step Breakdown

#### Step 1: Title & Category
- Title input with validation (5-120 characters)
- Optional category selection (Tech, Design, Writing, etc.)
- Character counter

#### Step 2: Details & Requirements
- Description input with validation (minimum 20 characters)
- Optional timeline field
- Optional skills required field
- Placeholder for future attachments feature

#### Step 3: Compensation
- Toggle for "Honor" bounties (no payment)
- Preset amount buttons ($5, $10, $25, $50, $100)
- Custom amount input
- Escrow information banner

#### Step 4: Location & Visibility
- Work type selection (In Person / Online)
- Location input (required for in-person)
- Privacy information about location sharing
- Public visibility explanation

#### Step 5: Review & Confirm
- Read-only review of all entered data
- Escrow protection modal with detailed explanation
- Submit with loading state
- Success/error handling

## File Structure

```
app/screens/CreateBounty/
├── index.tsx              # Main flow controller
├── StepTitle.tsx          # Step 1: Title & Category
├── StepDetails.tsx        # Step 2: Details & Requirements
├── StepCompensation.tsx   # Step 3: Compensation
├── StepLocation.tsx       # Step 4: Location & Visibility
├── StepReview.tsx         # Step 5: Review & Confirm
└── README.md             # This file

app/components/
├── StepperHeader.tsx      # Progress indicator UI
└── ValidationMessage.tsx  # Reusable validation message

app/hooks/
└── useBountyDraft.ts     # Draft persistence hook

app/services/
└── bountyService.ts      # API integration
```

## Validation Rules

### Title
- Required
- Minimum 5 characters
- Maximum 120 characters

### Description
- Required
- Minimum 20 characters

### Compensation
- For paid bounties: minimum $1
- Honor bounties: no amount required

### Location
- For in-person work: required, minimum 3 characters
- For online work: optional

## Usage

### Integration

The flow is integrated into the PostingsScreen with a toggle button:

```tsx
import { CreateBountyFlow } from 'app/screens/CreateBounty';

<CreateBountyFlow
  onComplete={(bountyId) => {
    // Handle successful creation
  }}
  onCancel={() => {
    // Handle cancellation
  }}
/>
```

### Navigation

Users can access the multi-step flow by:
1. Going to the "New" tab in Postings
2. Clicking "Use Guided Multi-Step Form"
3. Following the step-by-step process

### Draft Persistence

- Drafts are automatically saved after each step
- Drafts persist across app restarts
- Drafts are cleared upon successful submission
- Users can exit and return to their draft anytime

## Testing

### Unit Tests

Validation logic is tested in `tests/CreateBounty.validation.test.ts`:

```bash
npm test
```

All 20 validation tests pass successfully.

### Manual Testing Checklist

- [ ] Navigate to New tab and open multi-step flow
- [ ] Test validation on each step
- [ ] Complete flow with valid data
- [ ] Background app and reopen (verify draft persistence)
- [ ] Test with Honor bounty
- [ ] Test with paid bounty
- [ ] Test in-person vs online work type
- [ ] Verify escrow modal displays correctly
- [ ] Test network error handling
- [ ] Verify successful submission and navigation

## Future Enhancements

- [ ] Attachment upload support
- [ ] Location autocomplete with geolocation
- [ ] Rich text editor for description
- [ ] Preview mode before review step
- [ ] Save as template feature
- [ ] Analytics for step completion rates
- [ ] A/B testing framework

## Technical Notes

### Dependencies
- `@react-native-async-storage/async-storage` - Draft persistence
- `react-native-safe-area-context` - Safe area handling
- `@expo/vector-icons` - Icons

### Performance Considerations
- Draft saves are debounced to prevent excessive AsyncStorage writes
- Validation only runs on blur or when user attempts to proceed
- Lazy loading of step components

### Accessibility
- All interactive elements have `accessibilityLabel`
- Proper `accessibilityRole` on buttons and inputs
- Screen reader friendly error messages
- Proper focus management

## Support

For issues or questions about the Create Bounty flow:
1. Check the validation tests in `tests/CreateBounty.validation.test.ts`
2. Review this README
3. Check the inline documentation in each step component
4. Open an issue on GitHub with detailed reproduction steps
