# Progressive Disclosure Refactor - Create Bounty Flow

## 🎯 Objective
Refactor the "Create Bounty" flow to use progressive disclosure, revealing fields as they become relevant. This simplifies the process and makes it less intimidating for users.

## 📝 Problem Statement
The previous 5-step flow presented too many fields and steps, which could be overwhelming:
- **Step 1**: Title & Category
- **Step 2**: Details & Requirements (description, timeline, skills, attachments)
- **Step 3**: Compensation
- **Step 4**: Location & Visibility
- **Step 5**: Review & Confirm

## ✨ Solution
A streamlined **3-step progressive disclosure flow**:

### Step 1: The Core Idea
**What**: Capture the essential bounty information
- Title (5-120 characters required)
- Description (20+ characters required)

**Why**: Start with what matters most - what the user needs help with. This reduces initial friction.

### Step 2: The Reward
**What**: Define compensation
- Choose between payment amount or "for honor" (reputation only)
- Quick select presets: $5, $10, $25, $50, $100
- Custom amount input
- Escrow protection information

**Why**: Once the core idea is clear, users naturally think about compensation. The toggle makes it clear that payment is optional.

### Step 3: Location (Optional)
**What**: Specify logistics and submit
- Work type selector (In Person / Online)
- Location input (conditional - only for in-person)
- Submit button with loading state

**Why**: Location is truly optional (for online work). By making this the final step with inline submission, we reduce friction and eliminate the need for a separate review step.

## 🎨 Key Improvements

### 1. Progressive Disclosure
Fields are revealed only when needed:
- Location input only appears for in-person work
- Custom amount input always visible but emphasized when selected
- Info banners provide context at each step

### 2. Reduced Steps
**Before**: 5 steps with a review screen
**After**: 3 steps with inline submission

### 3. Eliminated Redundancy
- Removed separate "Review & Confirm" step
- Removed optional fields from initial steps (category, timeline, skills, attachments)
- Combined title and description into one step

### 4. Clear Call-to-Action
- Step 3 button changes from "Next" to "Create Bounty"
- Loading state during submission
- Clear visual feedback

## 📁 File Changes

### New Files
- `app/screens/CreateBounty/StepCoreIdea.tsx` - Combined title and description

### Modified Files
- `app/screens/CreateBounty/index.tsx` - Updated to 3-step flow
- `app/screens/CreateBounty/StepLocation.tsx` - Added submission capability

### Preserved (Deprecated)
- `app/screens/CreateBounty/StepTitle.tsx` - Legacy, kept for reference
- `app/screens/CreateBounty/StepDetails.tsx` - Legacy, kept for reference
- `app/screens/CreateBounty/StepReview.tsx` - Legacy, kept for reference

## 🧪 Validation

### Step 1 Validation
```typescript
validateTitle(value: string): string | null
  - Required
  - Min 5 characters
  - Max 120 characters

validateDescription(value: string): string | null
  - Required
  - Min 20 characters
```

### Step 2 Validation
```typescript
validateAmount(amount: number, isForHonor: boolean): string | null
  - If paid bounty: min $1
  - If honor bounty: no validation needed
```

### Step 3 Validation
```typescript
validateLocation(location: string, workType: string): string | null
  - If in-person: required, min 3 characters
  - If online: optional
```

## 🎯 User Flow

```
┌─────────────────────────────────────┐
│  Step 1: The Core Idea             │
│  ─────────────────────────────────  │
│  • What do you need help with?     │
│  • Describe what you need done     │
│                                     │
│  [Next →]                          │
└─────────────────────────────────────┘
              ↓
┌─────────────────────────────────────┐
│  Step 2: The Reward                │
│  ─────────────────────────────────  │
│  • Post for Honor [Toggle]         │
│  • OR Select amount ($5-$100+)     │
│  • Escrow protection info          │
│                                     │
│  [← Back]  [Next →]                │
└─────────────────────────────────────┘
              ↓
┌─────────────────────────────────────┐
│  Step 3: Location (Optional)       │
│  ─────────────────────────────────  │
│  • In Person / Online              │
│  • Location (if in-person)         │
│                                     │
│  [← Back]  [Create Bounty ✓]      │
└─────────────────────────────────────┘
```

## 💡 Design Principles Applied

1. **Progressive Disclosure**: Show fields only when needed
2. **Minimal Viable Input**: Collect only essential information
3. **Contextual Guidance**: Info banners at each step
4. **Clear Progression**: Visual stepper shows 3 steps total
5. **Instant Validation**: Real-time feedback on input errors
6. **Smart Defaults**: Sensible defaults for all optional fields
7. **Accessible**: Screen reader support, keyboard navigation

## 🚀 Benefits

### For Users
- ✅ Less overwhelming - 3 steps vs 5 steps
- ✅ Faster completion - fewer fields to fill
- ✅ Clear focus - one concept per step
- ✅ Better understanding - contextual info at each step

### For Developers
- ✅ Simpler state management
- ✅ Fewer components to maintain
- ✅ Clearer user journey
- ✅ Easier to test

## 🔄 Migration Notes

### Data Model
No changes to the `BountyDraft` interface - all fields preserved for backward compatibility.

### Removed UI Fields
The following fields are no longer shown in the UI but remain in the data model:
- `category` (optional) - defaults to empty string
- `timeline` (optional) - defaults to empty string
- `skills` (optional) - defaults to empty string
- `attachments` (optional) - defaults to empty array

These can be re-added in future iterations if needed.

## 📊 Metrics to Track

1. **Completion Rate**: % of users who complete all 3 steps
2. **Time to Complete**: Average time from start to submit
3. **Drop-off by Step**: Where users abandon the flow
4. **Error Rate**: Validation errors per step

## 🔮 Future Enhancements

1. **Conditional Fields**: Add category back as optional in step 1
2. **Attachment Support**: Allow file uploads in step 1 or 3
3. **Smart Suggestions**: AI-powered title/description suggestions
4. **Saved Addresses**: Quick-select from previous locations
5. **Template Library**: Start from common bounty types

## 📚 References

- [Progressive Disclosure (Nielsen Norman Group)](https://www.nngroup.com/articles/progressive-disclosure/)
- [Form Design Best Practices](https://www.smashingmagazine.com/2018/08/best-practices-for-mobile-form-design/)
- [Multi-Step Forms](https://www.nngroup.com/articles/multi-step-forms/)
