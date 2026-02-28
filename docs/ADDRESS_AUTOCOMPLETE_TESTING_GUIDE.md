# Address Autocomplete Testing Guide

## Prerequisites

Before testing the address autocomplete feature, you need:

1. **Google Places API Key** - Get one from [Google Cloud Console](https://console.cloud.google.com/google/maps-apis)
2. **Enabled APIs**: Places API and Geocoding API
3. **Development Environment**: Expo development server running

## Setup for Testing

### 1. Configure API Key

Add your API key to `.env` file:

```bash
EXPO_PUBLIC_GOOGLE_PLACES_API_KEY="YOUR_ACTUAL_API_KEY_HERE"
```

### 2. Restart Development Server

After adding the API key, restart the Expo development server:

```bash
# Stop current server (Ctrl+C)
npm start

# Or clear cache and restart
npm start -- --clear
```

### 3. Verify Configuration

The component will show a warning message if the API key is not configured properly. If you see this warning, check:
- API key is correctly set in `.env`
- Environment variable is prefixed with `EXPO_PUBLIC_`
- Development server was restarted after adding the key

## Manual Testing Scenarios

### Test 1: Basic Autocomplete

**Steps:**
1. Navigate to Create Bounty flow
2. Select "In Person" work type
3. Tap on Location input field
4. Type "123 Main" (minimum 2 characters)
5. Wait ~500ms for debounce

**Expected Results:**
- ✅ Suggestions appear below input
- ✅ Suggestions include addresses matching your input
- ✅ Loading indicator shows during API call
- ✅ Suggestions are formatted with main text and secondary text

### Test 2: Select Suggestion

**Steps:**
1. Follow Test 1 to display suggestions
2. Tap on any suggestion

**Expected Results:**
- ✅ Input field is populated with selected address
- ✅ Suggestions list disappears
- ✅ Location is validated as entered

### Test 3: Saved Addresses Integration

**Steps:**
1. Ensure you have some saved addresses (add via Location tab if needed)
2. Navigate to Create Bounty flow
3. Select "In Person" work type
4. Type a partial address that matches a saved address

**Expected Results:**
- ✅ Saved addresses appear in a separate section at the top
- ✅ API suggestions appear below saved addresses
- ✅ Both sections are clearly labeled
- ✅ Can select from either section

### Test 4: Debouncing Behavior

**Steps:**
1. Navigate to location input
2. Type quickly: "1" "2" "3" "space" "M" "a" "i" "n"
3. Observe network tab or console logs

**Expected Results:**
- ✅ No API call is made until typing stops
- ✅ Only one API call is made after 500ms pause
- ✅ Previous pending requests are cancelled

### Test 5: Rate Limiting

**Steps:**
1. Type "123 Main" and wait for results
2. Immediately type "456 Oak" 
3. Immediately type "789 Elm"
4. Check network requests

**Expected Results:**
- ✅ Requests are spaced at least 300ms apart
- ✅ No rapid-fire requests to API

### Test 6: Caching

**Steps:**
1. Type "San Francisco" - wait for results
2. Clear the input
3. Type "San Francisco" again

**Expected Results:**
- ✅ Second search returns instantly from cache
- ✅ No second API call is made (check network tab)
- ✅ Results are identical

### Test 7: Error Handling - No Results

**Steps:**
1. Type a nonsense address: "asdfghjkl qwertyuiop"
2. Wait for API response

**Expected Results:**
- ✅ No error message shown
- ✅ Suggestions list is empty or disappears
- ✅ User can continue typing

### Test 8: Error Handling - Network Failure

**Steps:**
1. Turn off internet connection or use network throttling
2. Type "123 Main St"
3. Wait for timeout

**Expected Results:**
- ✅ Error message is displayed
- ✅ Error is user-friendly (not technical)
- ✅ Can still use saved addresses
- ✅ Can continue to online when connection restored

### Test 9: Error Handling - Invalid API Key

**Steps:**
1. Set invalid API key in `.env`
2. Restart dev server
3. Try to use autocomplete

**Expected Results:**
- ✅ Warning message about configuration
- ✅ Saved addresses still work
- ✅ Can still type address manually

### Test 10: Country Filtering

**Steps:**
1. Type "London" in the location field
2. Observe suggestions

**Expected Results:**
- ✅ Should show US locations first (if countryCode='us' is set)
- ✅ May include UK locations but deprioritized

### Test 11: Location-Based Suggestions

**Steps:**
1. Grant location permission
2. Type "Main St" near San Francisco
3. Note the suggestions
4. Compare with same search from New York

**Expected Results:**
- ✅ Suggestions prioritize nearby addresses
- ✅ Distance from user affects ranking

### Test 12: Minimum Character Threshold

**Steps:**
1. Type single character "a"
2. Observe behavior

**Expected Results:**
- ✅ No API call is made
- ✅ No suggestions appear
- ✅ No error is shown

### Test 13: Accessibility - Screen Reader

**Steps:**
1. Enable screen reader (VoiceOver on iOS, TalkBack on Android)
2. Navigate to location input
3. Type to show suggestions
4. Navigate through suggestions

**Expected Results:**
- ✅ Input field is announced
- ✅ Each suggestion is readable
- ✅ Selection is announced
- ✅ Loading state is announced

### Test 14: Accessibility - Keyboard Navigation

**Steps:**
1. Use external keyboard
2. Tab to location field
3. Type to show suggestions
4. Use arrow keys to navigate

**Expected Results:**
- ✅ Can tab to input field
- ✅ Can navigate suggestions with arrows
- ✅ Can select with Enter key

### Test 15: Online/Offline Transition

**Steps:**
1. Start with internet connection
2. Type address and see API results
3. Turn off internet
4. Try another search
5. Turn internet back on
6. Try another search

**Expected Results:**
- ✅ Works normally when online
- ✅ Falls back to saved addresses when offline
- ✅ Resumes API calls when back online
- ✅ No crashes or freezes

## Performance Testing

### Test P1: API Response Time

**Metrics to Monitor:**
- Time from keystroke to first suggestion: < 1 second
- Time for cached results: < 100ms
- Memory usage: Should not grow unbounded

**Tools:**
- Chrome DevTools Network tab
- React Native Performance Monitor
- Expo Go performance overlay

### Test P2: UI Responsiveness

**Metrics to Monitor:**
- Input field should remain responsive while loading
- Scrolling should be smooth
- Typing should not lag

## Edge Cases

### Edge Case 1: Very Long Address

**Test:**
- Type an extremely long address string (200+ characters)

**Expected:**
- ✅ Input field handles long text
- ✅ Suggestions are displayed properly
- ✅ No layout issues

### Edge Case 2: Special Characters

**Test:**
- Type addresses with special characters: "O'Brien St.", "café", "北京"

**Expected:**
- ✅ Special characters are handled
- ✅ API returns results if available
- ✅ No encoding errors

### Edge Case 3: Rapid Component Mount/Unmount

**Test:**
- Navigate to location step
- Immediately navigate back
- Repeat several times quickly

**Expected:**
- ✅ No memory leaks
- ✅ No uncanceled API calls
- ✅ No error messages

### Edge Case 4: Multiple Simultaneous Users (API Quota)

**Test:**
- Multiple team members test simultaneously

**Expected:**
- ✅ API quota is monitored
- ✅ Rate limiting prevents quota exhaustion
- ✅ Graceful handling if quota exceeded

## Automated Testing

### Unit Tests

Run the unit test suite:

```bash
npm run test:unit -- __tests__/unit/address-autocomplete-service.test.ts
```

### Integration Tests

Run integration tests:

```bash
npm run test:integration
```

### E2E Tests

E2E tests should cover:
- Complete bounty creation flow with address selection
- Offline/online transitions
- Error recovery

## Debugging

### Enable Debug Logging

Add debug logs to the service:

```typescript
// In address-autocomplete-service.ts
console.log('Searching for:', query);
console.log('API response:', data);
console.log('Cache hit:', cacheKey);
```

### Monitor API Calls

Use React Native Debugger or Chrome DevTools:
1. Open debugger
2. Navigate to Network tab
3. Filter for "googleapis.com"
4. Monitor requests and responses

### Check Configuration

```typescript
import { addressAutocompleteService } from 'lib/services/address-autocomplete-service';

console.log('Is configured:', addressAutocompleteService.isConfigured());
```

## Common Issues

### Issue: Suggestions Not Appearing

**Possible Causes:**
1. API key not configured
2. API key doesn't have Places API enabled
3. API key has restrictions blocking the request
4. Network connection issue

**Solutions:**
1. Verify API key in `.env`
2. Check Google Cloud Console for enabled APIs
3. Review API key restrictions
4. Test network connection

### Issue: "REQUEST_DENIED" Error

**Cause:** API key is invalid or restricted

**Solution:**
1. Verify API key is correct
2. Check API restrictions in Google Cloud Console
3. Ensure billing is enabled
4. Try creating a new API key

### Issue: High API Costs

**Cause:** Too many API calls

**Solution:**
1. Verify debouncing is working (500ms)
2. Check cache is functioning
3. Implement rate limiting (300ms)
4. Review usage in Google Cloud Console
5. Consider increasing debounce delay

### Issue: Slow Performance

**Possible Causes:**
1. Network latency
2. Too many suggestions rendering
3. Re-renders on every keystroke

**Solutions:**
1. Check network connection
2. Limit number of suggestions displayed
3. Verify debouncing is working
4. Use React DevTools Profiler

## Metrics to Track

After deployment, monitor:

- **API Usage**: Calls per day/month
- **Cache Hit Rate**: Percentage of searches served from cache
- **Error Rate**: Percentage of failed API calls
- **User Adoption**: Percentage of bounties using autocomplete vs manual entry
- **Cost**: Monthly Google Places API charges

## Reporting Issues

When reporting issues, include:

1. **Environment**: iOS/Android, version, device
2. **Steps to Reproduce**: Detailed steps
3. **Expected vs Actual**: What should happen vs what does happen
4. **Screenshots**: If UI-related
5. **Logs**: Console logs and error messages
6. **Network Logs**: API request/response data

## Next Steps

After successful testing:

1. ✅ Verify all test scenarios pass
2. ✅ Review performance metrics
3. ✅ Get code review
4. ✅ Run security scan
5. ✅ Deploy to staging
6. ✅ Test on staging with real users
7. ✅ Deploy to production
8. ✅ Monitor metrics and costs

## Resources

- [Google Places API Documentation](https://developers.google.com/maps/documentation/places/web-service/overview)
- [ADDRESS_AUTOCOMPLETE_INTEGRATION.md](./ADDRESS_AUTOCOMPLETE_INTEGRATION.md)
- [React Native Testing Library](https://callstack.github.io/react-native-testing-library/)
