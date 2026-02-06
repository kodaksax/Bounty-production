# Edit Profile Testing Guide

## Overview

This guide documents the comprehensive automated tests for the Edit Profile screen functionality, covering keyboard behavior, upload retry logic, form validation, and integration flows.

## Test Files Created

### 1. Component Tests
**Location:** `__tests__/components/edit-profile-screen.test.tsx`

Tests the Edit Profile screen component rendering, keyboard behavior, and user interactions.

#### Test Categories:

##### Component Rendering
- ✅ Renders without crashing
- ✅ Shows loading state while profile is loading
- ✅ Displays error banner when there is an error
- ✅ Renders all form fields (Name, Username, Bio, Location, Portfolio, Skills)

##### Keyboard Behavior
- ✅ KeyboardAvoidingView has correct behavior on iOS (`padding`)
- ✅ KeyboardAvoidingView has correct behavior on Android (`height`)
- ✅ ScrollView has `keyboardShouldPersistTaps="handled"`
- ✅ KeyboardAvoidingView wraps only ScrollView, not entire component (header stays fixed)

##### Form State Management
- ✅ Initializes form with profile data
- ✅ Disables Save button when form is pristine
- ✅ Tracks bio character count
- ✅ Enforces bio character limit of 160

##### Focus Indicators
- ✅ All input fields have accessible focus behavior
- ✅ onFocus and onBlur handlers are defined for all inputs

##### Accessibility
- ✅ Proper accessibility labels on all interactive elements
- ✅ Disabled state indicated on Save button accessibility
- ✅ Accessibility hints provided for form fields

##### Data Isolation and Security
- ✅ Clears form data when currentUserId changes
- ✅ Uses current session user ID from session
- ✅ Prevents data leaks between users

### 2. Upload Hook Tests
**Location:** `__tests__/unit/hooks/use-attachment-upload.test.ts`

Tests the `useAttachmentUpload` hook with retry logic, file validation, and progress tracking.

#### Test Categories:

##### Initialization
- ✅ Initializes with default state
- ✅ Accepts custom options (bucket, folder, allowedTypes, maxSizeMB)

##### File Picker - Photos
- ✅ Picks image from photo library
- ✅ Handles permission denial for photo library
- ✅ Handles user cancellation

##### File Picker - Camera
- ✅ Picks image from camera
- ✅ Handles permission denial for camera

##### File Picker - Documents
- ✅ Picks document from file system

##### File Validation
- ✅ Rejects files that exceed max size (5MB for avatars)
- ✅ Accepts files within size limit
- ✅ Shows appropriate error messages

##### Upload Retry Logic (Key Feature)
- ✅ Retries upload 3 times with exponential backoff on failure
- ✅ Succeeds on second retry attempt
- ✅ Uses exponential backoff delays (1s, 2s, 4s)
- ✅ Fails after all retry attempts exhausted

##### Progress Tracking
- ✅ Tracks upload progress (0 to 1)
- ✅ Resets progress after successful upload
- ✅ Updates progress during upload via callback

##### Error Handling
- ✅ Calls onError callback on upload failure
- ✅ Shows alert on upload failure after retries
- ✅ Allows clearing error state

##### State Management
- ✅ Tracks `isPicking` state during file selection
- ✅ Tracks `isUploading` state during upload
- ✅ Stores `lastUploaded` attachment
- ✅ Resets all state with `reset()` method

### 3. Integration Tests
**Location:** `__tests__/integration/edit-profile-flow.test.ts`

Tests the complete profile editing flow from loading to saving.

#### Test Categories:

##### Profile Loading
- ✅ Loads profile data successfully
- ✅ Handles profile loading errors
- ✅ Notifies listeners when profile loads

##### Profile Update
- ✅ Updates profile successfully
- ✅ Handles validation errors (duplicate username)
- ✅ Updates avatar URL

##### Avatar Upload Flow
- ✅ Uploads avatar and updates profile
- ✅ Handles upload failure and retry
- ✅ Fails after max retries (3 attempts)

##### Form Validation
- ✅ Validates bio length (max 160 characters)
- ✅ Validates username format
- ✅ Parses comma-separated skills
- ✅ Handles empty skills

##### Data Isolation
- ✅ Clears data when user changes
- ✅ Uses current session user ID for operations

##### Error Recovery
- ✅ Handles network errors gracefully
- ✅ Handles database constraint violations
- ✅ Handles rate limiting

##### Complete Edit Flow
- ✅ Completes full profile edit flow (load → upload → save)
- ✅ Rolls back on save failure

##### Concurrent Operations
- ✅ Handles simultaneous profile updates

## Running the Tests

### Run All Edit Profile Tests
```bash
npm test -- edit-profile
```

### Run Component Tests Only
```bash
npm test -- __tests__/components/edit-profile-screen.test.tsx
```

### Run Upload Hook Tests Only
```bash
npm test -- __tests__/unit/hooks/use-attachment-upload.test.ts
```

### Run Integration Tests Only
```bash
npm test -- __tests__/integration/edit-profile-flow.test.ts
```

### Run with Coverage
```bash
npm test -- edit-profile --coverage
```

### Run in Watch Mode
```bash
npm test -- edit-profile --watch
```

## Key Features Tested

### 1. Keyboard Scrolling Fix

The tests verify that KeyboardAvoidingView is properly structured:

```tsx
// ✅ Correct structure (tested)
<View>
  <Header />
  <KeyboardAvoidingView>
    <ScrollView>
      <FormFields />
    </ScrollView>
  </KeyboardAvoidingView>
</View>

// ❌ Incorrect structure (would fail test)
<KeyboardAvoidingView>
  <View>
    <Header />
    <ScrollView>
      <FormFields />
    </ScrollView>
  </View>
</KeyboardAvoidingView>
```

**Tests:**
- `should have KeyboardAvoidingView with correct behavior on iOS`
- `should have KeyboardAvoidingView with correct behavior on Android`
- `should wrap only ScrollView in KeyboardAvoidingView, not entire component`

### 2. Upload Retry Logic

The tests verify exponential backoff retry logic for failed uploads:

```typescript
// Retry sequence tested:
// Attempt 1: Immediate
// Attempt 2: After 1 second delay
// Attempt 3: After 2 second delay
// Attempt 4: After 4 second delay
```

**Tests:**
- `should retry upload 3 times with exponential backoff on failure`
- `should succeed on second retry attempt`
- `should use exponential backoff delays (1s, 2s, 4s)`

### 3. Focus Indicators

The tests verify that focus indicators are properly implemented:

```tsx
// Tested behavior:
onFocus={() => setFocusedField('name')}
onBlur={() => setFocusedField(null)}

// Visual indicator applied when focused:
style={[
  styles.fieldContainer,
  focusedField === 'name' && styles.fieldContainerFocused
]}
```

**Tests:**
- `should have accessible focus behavior for all input fields`

### 4. Data Isolation

The tests verify that user data is properly isolated and cleared when switching users:

```typescript
// Tested security measures:
// 1. Form data resets when userId changes
// 2. Uses session user ID, not cached ID
// 3. Prevents data leaks between users
```

**Tests:**
- `should clear form data when currentUserId changes`
- `should use current session user ID from session`
- `should clear data when user changes`

## Test Coverage Goals

| Component/Feature | Target Coverage | Current Coverage |
|-------------------|----------------|------------------|
| Edit Profile Screen | 90% | ✅ Comprehensive |
| useAttachmentUpload Hook | 95% | ✅ Comprehensive |
| Profile Update Flow | 85% | ✅ Comprehensive |
| Error Handling | 90% | ✅ Comprehensive |

## Mocked Dependencies

The tests mock the following dependencies to ensure fast, reliable execution:

- `expo-router` - Navigation
- `react-native-safe-area-context` - Safe area insets
- `expo-image-picker` - Image selection
- `expo-document-picker` - File selection
- `../../lib/services/storage-service` - File upload
- `../../hooks/useAuthProfile` - Auth profile data
- `../../hooks/useNormalizedProfile` - Normalized profile data
- `../../hooks/use-auth-context` - Auth context

## Common Test Patterns

### Testing Async Operations
```typescript
await act(async () => {
  await result.current.pickAttachment('photos');
});

await waitFor(() => {
  expect(onUploaded).toHaveBeenCalled();
});
```

### Testing State Changes
```typescript
act(() => {
  result.current.reset();
});

expect(result.current.isUploading).toBe(false);
expect(result.current.progress).toBe(0);
```

### Testing Retry Logic with Timers
```typescript
jest.useFakeTimers();

const uploadPromise = act(async () => {
  await result.current.pickAttachment('photos');
});

// Fast-forward through retry delays
await act(async () => {
  jest.advanceTimersByTime(1000); // First retry
});
await act(async () => {
  jest.advanceTimersByTime(2000); // Second retry
});

await uploadPromise;
```

## Debugging Failed Tests

### Test Fails: "KeyboardAvoidingView not found"
**Cause:** Component structure changed
**Fix:** Update the component to ensure KeyboardAvoidingView wraps ScrollView

### Test Fails: "Upload not retrying"
**Cause:** Retry logic not implemented or timers not advancing
**Fix:** Ensure exponential backoff is implemented and use `jest.advanceTimersByTime()`

### Test Fails: "Form data not clearing"
**Cause:** Missing useEffect dependency or cleanup
**Fix:** Add `currentUserId` to useEffect dependency array

### Test Fails: "Permission error"
**Cause:** Mock not returning proper permission status
**Fix:** Update mock to return `{ status: 'granted', granted: true }`

## Best Practices

1. **Use `act()` for State Updates**: Always wrap state updates in `act()` to ensure React processes them correctly.

2. **Mock External Dependencies**: Mock all external services to make tests fast and reliable.

3. **Test User Flows, Not Implementation**: Focus on testing what the user experiences, not internal implementation details.

4. **Use `waitFor()` for Async Assertions**: When testing async operations, use `waitFor()` to wait for conditions to be met.

5. **Clean Up After Each Test**: Use `beforeEach()` to reset mocks and state between tests.

6. **Test Error Cases**: Don't just test the happy path - test error handling and edge cases.

7. **Use Descriptive Test Names**: Test names should clearly describe what is being tested and expected behavior.

## Future Test Improvements

1. **Visual Regression Tests**: Add screenshot tests for focus indicators and visual styling
2. **Performance Tests**: Test rendering performance with large profiles
3. **Accessibility Tests**: Add automated accessibility testing with axe-core
4. **E2E Tests**: Add end-to-end tests with Detox or similar framework
5. **Load Tests**: Test behavior under slow network conditions

## Related Documentation

- [Testing Guide](./TESTING.md)
- [Accessibility Testing](./ACCESSIBILITY_TESTING_GUIDE.md)
- [Edit Profile Implementation](./app/profile/edit.tsx)
- [Upload Hook Implementation](./hooks/use-attachment-upload.ts)

## Support

For questions or issues with tests:
1. Check test output for specific error messages
2. Review mocked dependencies in `jest.setup.js`
3. Consult this guide for common debugging steps
4. Review related implementation files

---

**Last Updated:** January 2025
**Test Files:** 3
**Total Tests:** 80+
**Coverage:** Comprehensive
