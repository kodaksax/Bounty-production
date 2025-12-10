# Address Autocomplete Integration Guide

## Overview

This document describes the integration of the Google Places API for real-time address autocomplete functionality in the BountyExpo app's create bounty flow.

## Features

### 🎯 Core Functionality
- **Real-time Suggestions**: As users type, address suggestions appear from Google Places API
- **Saved Addresses**: Integration with local saved address library
- **Location-based Results**: Prioritizes addresses near user's current location
- **Debounced API Calls**: Reduces API costs with intelligent request batching
- **Caching**: Stores recent suggestions to minimize redundant API calls
- **Rate Limiting**: Prevents excessive API requests
- **Error Handling**: Graceful degradation when API is unavailable
- **Offline Support**: Falls back to saved addresses when offline

### 🔧 Technical Implementation

#### 1. Service Layer
**File**: `lib/services/address-autocomplete-service.ts`

The service layer handles all communication with Google Places API:
- Autocomplete suggestions
- Place details retrieval
- Address validation
- Caching and rate limiting
- Error handling

```typescript
import { addressAutocompleteService } from 'lib/services/address-autocomplete-service';

// Search for addresses
const suggestions = await addressAutocompleteService.searchAddresses('123 Main St', {
  latitude: 37.7749,
  longitude: -122.4194,
  radius: 50000,
  types: ['address', 'geocode'],
  components: 'country:us'
});

// Get detailed place info
const details = await addressAutocompleteService.getPlaceDetails(placeId);
```

#### 2. Reusable Component
**File**: `components/AddressAutocomplete.tsx`

A fully-featured, reusable React Native component:
- Text input with autocomplete dropdown
- Saved addresses section
- API suggestions section
- Loading states
- Error messages
- Accessibility support

```tsx
<AddressAutocomplete
  value={address}
  onChangeText={setAddress}
  onSelectAddress={(suggestion) => {
    setAddress(suggestion.description);
  }}
  placeholder="Enter address"
  minChars={2}
  debounceMs={500}
  showSavedAddresses={true}
  savedAddresses={savedAddresses}
  userLocation={currentLocation}
  searchRadius={50000}
  countryCode="us"
/>
```

#### 3. Integration in Create Bounty Flow
**File**: `app/screens/CreateBounty/StepLocation.tsx`

The location step now uses the AddressAutocomplete component to provide enhanced address input with real-time suggestions from Google Places API.

## Configuration

### Prerequisites
1. **Google Cloud Account**: Required for accessing Google Places API
2. **API Key**: Generate at [Google Cloud Console](https://console.cloud.google.com/google/maps-apis)
3. **Enabled APIs**: 
   - Places API
   - Geocoding API (optional but recommended)

### Setup Steps

#### 1. Get Google Places API Key
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable "Places API" and "Geocoding API"
4. Create credentials → API Key
5. Restrict the API key:
   - **Application restrictions**: Set to "Android apps" or "iOS apps" for mobile
   - **API restrictions**: Limit to Places API and Geocoding API

#### 2. Configure Environment Variables
Add your API key to your environment configuration:

**`.env` file:**
```bash
EXPO_PUBLIC_GOOGLE_PLACES_API_KEY="AIzaSyC-your-actual-api-key-here"
```

**`app.json`:**
The key is automatically picked up from environment variables via the `extra` configuration.

#### 3. Security Best Practices
- ⚠️ **Never commit API keys to version control**
- 🔒 Use separate keys for development and production
- 🛡️ Restrict keys to specific platforms/bundle IDs
- 📊 Set up billing alerts to monitor usage
- 🔄 Rotate keys regularly
- 📱 Use Android/iOS bundle ID restrictions in production

### Cost Management

#### Google Places API Pricing
- **Autocomplete (per session)**: $2.83 per 1,000 sessions
- **Place Details**: $17 per 1,000 requests

A "session" is defined as a set of autocomplete requests followed by a place details request.

#### Cost Optimization Strategies Implemented
1. **Debouncing**: 500ms delay reduces API calls
2. **Minimum Characters**: Requires 2+ characters before searching
3. **Rate Limiting**: Maximum one request per 300ms
4. **Caching**: Results cached for 5 minutes
5. **Smart Fallback**: Uses saved addresses when available

#### Estimated Costs
Based on typical usage patterns:
- **Low usage** (100 bounties/day): ~$10-15/month
- **Medium usage** (1,000 bounties/day): ~$100-150/month
- **High usage** (10,000 bounties/day): ~$1,000-1,500/month

## Usage

### Basic Usage

```tsx
import { AddressAutocomplete } from 'components/AddressAutocomplete';

function MyComponent() {
  const [address, setAddress] = useState('');

  return (
    <AddressAutocomplete
      value={address}
      onChangeText={setAddress}
      placeholder="Enter your address"
    />
  );
}
```

### Advanced Usage with Place Details

```tsx
import { AddressAutocomplete } from 'components/AddressAutocomplete';
import { addressAutocompleteService } from 'lib/services/address-autocomplete-service';

function MyComponent() {
  const [address, setAddress] = useState('');
  const [coordinates, setCoordinates] = useState(null);

  const handleSelectAddress = async (suggestion) => {
    // Fetch detailed information
    const details = await addressAutocompleteService.getPlaceDetails(
      suggestion.placeId
    );
    
    if (details) {
      setAddress(details.formattedAddress);
      setCoordinates({
        lat: details.latitude,
        lng: details.longitude
      });
    }
  };

  return (
    <AddressAutocomplete
      value={address}
      onChangeText={setAddress}
      onSelectAddress={handleSelectAddress}
      showSavedAddresses={true}
      savedAddresses={mySavedAddresses}
    />
  );
}
```

## Validation

### Client-side Validation
The component includes built-in validation:
- Minimum 3 characters for in-person work
- Validates address format
- Checks for complete addresses

### Address Validation Example

```typescript
import { addressAutocompleteService } from 'lib/services/address-autocomplete-service';

const isValid = await addressAutocompleteService.validateAddress(userInput);
if (!isValid) {
  showError('Please enter a valid address');
}
```

## Edge Cases & Error Handling

### 1. API Key Not Configured
**Behavior**: Component shows warning message, falls back to saved addresses only
**User Experience**: Users can still use saved addresses

### 2. Network Error / API Failure
**Behavior**: Shows error message, retains user input
**User Experience**: Can continue typing or use saved addresses

### 3. No Results Found
**Behavior**: Shows empty state
**User Experience**: Clear indication that no matches were found

### 4. Rate Limiting
**Behavior**: Built-in rate limiting prevents excessive requests
**User Experience**: Transparent to user, maintains smooth UX

### 5. Incomplete/Ambiguous Addresses
**Behavior**: Shows multiple suggestions
**User Experience**: User selects most appropriate option

### 6. Offline Mode
**Behavior**: Automatically uses saved addresses only
**User Experience**: Seamless fallback to local data

## Testing

### Unit Tests
Located in: `__tests__/unit/address-autocomplete-service.test.ts`

Run unit tests:
```bash
npm run test:unit
```

### Integration Tests
Located in: `__tests__/integration/CreateBounty.address-autocomplete.test.tsx`

Run integration tests:
```bash
npm run test:integration
```

### Manual Testing Checklist

#### Configuration Testing
- [ ] Verify API key is properly configured
- [ ] Test with invalid API key (should show warning)
- [ ] Test without API key (should fall back gracefully)

#### Functionality Testing
- [ ] Type 2+ characters, verify suggestions appear
- [ ] Select suggestion, verify address is populated
- [ ] Test with saved addresses
- [ ] Verify debouncing works (no request on every keystroke)
- [ ] Test location-based suggestions (when location permission granted)
- [ ] Test country filtering (US addresses)

#### Edge Case Testing
- [ ] Test with very short input (< 2 characters)
- [ ] Test with invalid address
- [ ] Test with special characters
- [ ] Test network failure scenarios
- [ ] Test offline behavior
- [ ] Test rapid typing (debounce behavior)

#### Accessibility Testing
- [ ] Test with screen reader
- [ ] Verify keyboard navigation works
- [ ] Check focus management
- [ ] Verify ARIA labels are present

#### Performance Testing
- [ ] Monitor API call frequency
- [ ] Verify caching works (same query twice)
- [ ] Check memory usage with many suggestions
- [ ] Test with slow network connection

## Maintenance

### Monitoring API Usage
1. Set up Google Cloud Monitoring
2. Create billing alerts at various thresholds
3. Review monthly usage reports
4. Monitor error rates

### Updating the Library
1. Check for updates to Google Places API
2. Review changelog for breaking changes
3. Update service layer if needed
4. Run full test suite
5. Deploy to staging first

### Common Issues & Solutions

#### Issue: "API key not configured"
**Solution**: Ensure `EXPO_PUBLIC_GOOGLE_PLACES_API_KEY` is set in `.env`

#### Issue: Suggestions not appearing
**Solutions**:
- Check internet connection
- Verify API key has Places API enabled
- Check API key restrictions
- Review console logs for errors

#### Issue: High API costs
**Solutions**:
- Increase debounce delay
- Increase minimum character requirement
- Review usage patterns
- Consider implementing session-based pricing optimization

#### Issue: Slow response times
**Solutions**:
- Check network connection
- Verify API endpoint is responsive
- Consider adding request timeout
- Review caching implementation

## Accessibility

### Features Implemented
- ✅ Screen reader support with proper ARIA labels
- ✅ Keyboard navigation
- ✅ High contrast mode support
- ✅ Touch target sizing (minimum 44x44 points)
- ✅ Clear focus indicators
- ✅ Descriptive error messages

### Testing with Accessibility Tools
- iOS: VoiceOver
- Android: TalkBack
- Automated: Use `@testing-library/react-native` with accessibility queries

## Future Enhancements

### Planned Features
1. **Multi-language Support**: Support for addresses in different languages
2. **Address Verification**: Validate addresses with USPS or similar services
3. **Smart Defaults**: Learn from user's frequent locations
4. **Batch Geocoding**: Optimize for multiple addresses
5. **Enhanced Caching**: IndexedDB/AsyncStorage for persistent cache
6. **Predictive Prefetch**: Preload likely suggestions
7. **Analytics Integration**: Track autocomplete usage patterns

### Performance Optimizations
- Implement virtual scrolling for large suggestion lists
- Add service worker for offline caching
- Optimize bundle size by lazy-loading the component
- Use Web Workers for heavy computations

## Related Documentation
- [Google Places API Documentation](https://developers.google.com/maps/documentation/places/web-service/overview)
- [Location Features Summary](./LOCATION_FEATURES_SUMMARY.md)
- [Create Bounty Implementation](./CREATE_BOUNTY_IMPLEMENTATION.md)
- [Testing Guide](./TESTING.md)

## Support
For issues or questions:
1. Check this documentation
2. Review Google Places API docs
3. Check console logs for errors
4. Create an issue in the repository

## License
This integration uses Google Places API which has its own terms of service. Ensure compliance with Google's terms when deploying.
