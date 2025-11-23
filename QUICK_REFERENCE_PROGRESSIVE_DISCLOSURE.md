# Quick Reference: Progressive Disclosure Changes

## 🎯 What Changed?

### Old Flow (5 Steps)
```
Step 1: Title & Category
   ↓
Step 2: Details & Requirements (description, timeline, skills, attachments)
   ↓
Step 3: Compensation
   ↓
Step 4: Location & Visibility
   ↓
Step 5: Review & Confirm
   ↓
SUBMIT
```

### New Flow (3 Steps)
```
Step 1: The Core Idea (title + description)
   ↓
Step 2: The Reward (amount or honor)
   ↓
Step 3: Location (optional) → SUBMIT
```

## 📝 What Fields Are Where?

### Step 1: The Core Idea
- ✅ **Title** (required, 5-120 chars)
- ✅ **Description** (required, 20+ chars)
- ❌ ~~Category~~ (removed)
- ❌ ~~Timeline~~ (removed)
- ❌ ~~Skills~~ (removed)
- ❌ ~~Attachments~~ (removed)

### Step 2: The Reward
- ✅ **Honor Toggle** (optional)
- ✅ **Amount** (required if not honor, $1+)
- ✅ **Escrow Info** (informational)

### Step 3: Location (Optional)
- ✅ **Work Type** (in-person or online)
- ✅ **Location** (conditional, required if in-person)
- ✅ **Submit Button** (inline)

## 🔄 Progressive Disclosure Rules

| Condition | Show | Hide |
|-----------|------|------|
| Honor = ON | Honor info banner | Amount presets, custom input |
| Honor = OFF | Amount fields | Honor info banner |
| Work Type = In Person | Location input | Remote work info |
| Work Type = Online | Remote work info | Location input |

## 📂 Files Modified

### New Files
- `app/screens/CreateBounty/StepCoreIdea.tsx`

### Updated Files
- `app/screens/CreateBounty/index.tsx`
- `app/screens/CreateBounty/StepLocation.tsx`

### Unchanged (Still Exist)
- `app/screens/CreateBounty/StepTitle.tsx`
- `app/screens/CreateBounty/StepDetails.tsx`
- `app/screens/CreateBounty/StepCompensation.tsx`
- `app/screens/CreateBounty/StepReview.tsx`

## 🎨 Visual Changes

### Step Indicator
- Old: `●━○━○━○━○` (5 steps)
- New: `●━○━○` (3 steps)

### Button Text (Step 3)
- Old: "Next" → Review screen → "Submit"
- New: "Create Bounty" (direct submission)

### Loading State
- Old: Review screen shows loading
- New: Step 3 button shows "Creating..." with spinner

## 🔧 Developer Notes

### Import Changes
```typescript
// Old import (not used anymore in index.tsx)
import { StepTitle } from './StepTitle';
import { StepDetails } from './StepDetails';
import { StepReview } from './StepReview';

// New import
import { StepCoreIdea } from './StepCoreIdea';
```

### Step Count
```typescript
// Old
const TOTAL_STEPS = 5;

// New
const TOTAL_STEPS = 3;
```

### Step Titles
```typescript
// Old
const STEP_TITLES = [
  'Title & Category',
  'Details & Requirements',
  'Compensation',
  'Location & Visibility',
  'Review & Confirm',
];

// New
const STEP_TITLES = [
  'The Core Idea',
  'The Reward',
  'Location (Optional)',
];
```

## 📊 Data Model (No Changes!)

```typescript
// BountyDraft interface - UNCHANGED
export interface BountyDraft {
  title: string;              // Used in Step 1
  category?: string;          // Not shown in UI (defaults to '')
  description: string;        // Used in Step 1
  amount: number;             // Used in Step 2
  isForHonor: boolean;        // Used in Step 2
  location: string;           // Used in Step 3
  workType: 'online' | 'in_person';  // Used in Step 3
  timeline?: string;          // Not shown in UI (defaults to '')
  skills?: string;            // Not shown in UI (defaults to '')
  attachments?: Attachment[]; // Not shown in UI (defaults to [])
}
```

## ✅ Validation Rules

### Step 1 (Core Idea)
```typescript
validateTitle(value: string)
  ❌ Empty → "Title is required"
  ❌ < 5 chars → "Title must be at least 5 characters"
  ❌ > 120 chars → "Title must not exceed 120 characters"
  ✅ 5-120 chars → Valid

validateDescription(value: string)
  ❌ Empty → "Description is required"
  ❌ < 20 chars → "Description must be at least 20 characters"
  ✅ 20+ chars → Valid
```

### Step 2 (Reward)
```typescript
validateAmount(amount: number, isForHonor: boolean)
  IF isForHonor === true:
    ✅ Any amount → Valid (amount ignored)
  IF isForHonor === false:
    ❌ < $1 → "Amount must be at least $1"
    ✅ ≥ $1 → Valid
```

### Step 3 (Location)
```typescript
validateLocation(location: string, workType: string)
  IF workType === 'online':
    ✅ Any location (including empty) → Valid
  IF workType === 'in_person':
    ❌ Empty → "Location is required for in-person work"
    ❌ < 3 chars → "Location must be at least 3 characters"
    ✅ 3+ chars → Valid
```

## 🚀 Testing Checklist

Quick smoke test:
- [ ] Navigate to create bounty
- [ ] See step 1 with title + description
- [ ] Fill both fields, click Next
- [ ] See step 2 with amount options
- [ ] Select amount, click Next
- [ ] See step 3 with location options
- [ ] Button says "Create Bounty" (not "Next")
- [ ] Fill location, click "Create Bounty"
- [ ] See success message
- [ ] Bounty appears in feed

## 📞 Support

### Common Issues

**Q: I don't see the new 3-step flow**
- A: Clear app cache and restart

**Q: My old draft has extra fields**
- A: Old drafts are compatible; extra fields are ignored

**Q: Can I add attachments?**
- A: Not in current UI, but feature can be added back

**Q: Where did category go?**
- A: Removed for simplicity, can be added back if needed

### Need Help?
- See `PROGRESSIVE_DISCLOSURE_REFACTOR.md` for detailed explanation
- See `TESTING_GUIDE_PROGRESSIVE_DISCLOSURE.md` for test cases
- See `PROGRESSIVE_DISCLOSURE_UI_MOCKUP.md` for visual guide

## 📅 Timeline

- **Planning**: Problem statement received
- **Implementation**: 3-step flow created
- **Documentation**: Complete guides written
- **Code Review**: All issues addressed
- **Security Scan**: Passed with 0 vulnerabilities
- **Status**: ✅ Ready for testing
- **Next**: Manual QA testing needed

---

**Last Updated**: 2025-11-23
**Version**: 1.0
**Status**: Ready for Review
