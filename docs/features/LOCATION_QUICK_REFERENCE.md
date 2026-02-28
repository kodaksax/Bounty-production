# Location Features - Quick Reference Guide

## 🚀 Quick Start

### Using Location in Your Component

```typescript
import { useLocation } from 'app/hooks/useLocation';

function MyComponent() {
  const { location, permission, requestPermission, calculateDistance } = useLocation();
  
  // Request permission
  const handleRequestPermission = async () => {
    await requestPermission();
  };
  
  // Calculate distance to a point
  if (location) {
    const distance = calculateDistance({ latitude: 37.7749, longitude: -122.4194 });
    console.log(`Distance: ${distance} miles`);
  }
}
```

### Using Address Library

```typescript
import { useAddressLibrary } from 'app/hooks/useAddressLibrary';

function MyComponent() {
  const { addresses, addAddress, deleteAddress, searchAddresses } = useAddressLibrary();
  
  // Add an address
  const handleAdd = async () => {
    await addAddress('Home', '123 Main St, San Francisco, CA');
  };
  
  // Search addresses
  const results = await searchAddresses('home');
}
```

## 📋 API Reference

### useLocation Hook

**Returns:**
```typescript
{
  location: LocationCoordinates | null;
  permission: LocationPermissionState | null;
  isLoading: boolean;
  error: string | null;
  requestPermission: () => Promise<void>;
  getCurrentLocation: () => Promise<void>;
  calculateDistance: (to: LocationCoordinates, unit?: 'miles' | 'km') => number | null;
}
```

**Example:**
```typescript
const { location, permission, error } = useLocation();

if (error) {
  console.error('Location error:', error);
}

if (permission?.granted && location) {
  console.log('User location:', location);
}
```

### useAddressLibrary Hook

**Returns:**
```typescript
{
  addresses: SavedAddress[];
  isLoading: boolean;
  error: string | null;
  addAddress: (label: string, address: string) => Promise<SavedAddress | null>;
  updateAddress: (id: string, label: string, address: string) => Promise<SavedAddress | null>;
  deleteAddress: (id: string) => Promise<boolean>;
  searchAddresses: (query: string) => Promise<SavedAddress[]>;
  refresh: () => Promise<void>;
}
```

**Example:**
```typescript
const { addresses, addAddress, isLoading } = useAddressLibrary();

if (isLoading) {
  return <LoadingSpinner />;
}

// Add address
const newAddress = await addAddress('Office', '456 Market St');
```

### locationService

**Methods:**

```typescript
// Request permission
const status = await locationService.requestPermission();

// Get permission status (without requesting)
const status = await locationService.getPermissionStatus();

// Get current location
const coords = await locationService.getCurrentLocation();

// Calculate distance between two points
const distance = locationService.calculateDistance(
  { latitude: 37.7749, longitude: -122.4194 },
  { latitude: 37.7849, longitude: -122.4294 },
  'miles' // or 'km'
);

// Geocode an address
const coords = await locationService.geocodeAddress('123 Main St, SF, CA');

// Reverse geocode coordinates
const address = await locationService.reverseGeocode({ latitude: 37.7749, longitude: -122.4194 });
```

### addressLibraryService

**Methods:**

```typescript
// Get all addresses
const addresses = await addressLibraryService.getAll();

// Add address
const newAddr = await addressLibraryService.add('Home', '123 Main St');

// Update address
const updated = await addressLibraryService.update('addr-id', 'My Home', '123 Main St');

// Delete address
const success = await addressLibraryService.delete('addr-id');

// Search addresses
const results = await addressLibraryService.search('home');

// Get by ID
const addr = await addressLibraryService.getById('addr-id');

// Clear all
await addressLibraryService.clear();
```

## 🎨 UI Components

### Location Permission Status

```typescript
{permission?.granted ? (
  <View>
    <MaterialIcons name="check-circle" size={20} color="#6ee7b7" />
    <Text>Location Enabled</Text>
  </View>
) : (
  <TouchableOpacity onPress={requestPermission}>
    <Text>Grant Permission</Text>
  </TouchableOpacity>
)}
```

### Address List

```typescript
<FlatList
  data={addresses}
  keyExtractor={(item) => item.id}
  renderItem={({ item }) => (
    <View>
      <Text>{item.label}</Text>
      <Text>{item.address}</Text>
    </View>
  )}
/>
```

### Distance Filter Chips

```typescript
const distances = [5, 10, 25, 50];

{distances.map((miles) => (
  <TouchableOpacity
    key={miles}
    onPress={() => setFilter(miles)}
  >
    <Text>{miles}mi</Text>
  </TouchableOpacity>
))}
```

## 📐 Type Definitions

### SavedAddress
```typescript
interface SavedAddress {
  id: string;
  label: string;
  address: string;
  latitude?: number;
  longitude?: number;
  createdAt: string;
}
```

### LocationCoordinates
```typescript
interface LocationCoordinates {
  latitude: number;
  longitude: number;
}
```

### LocationPermissionState
```typescript
interface LocationPermissionState {
  granted: boolean;
  canAskAgain: boolean;
  status: 'granted' | 'denied' | 'undetermined';
}
```

## 🔧 Common Patterns

### Check Permission Before Using Location

```typescript
const { permission, requestPermission } = useLocation();

if (!permission?.granted) {
  return (
    <View>
      <Text>Location permission needed</Text>
      <Button title="Grant" onPress={requestPermission} />
    </View>
  );
}

// Permission granted, use location features
```

### Calculate Distance with Fallback

```typescript
const { location, calculateDistance } = useLocation();

const getDistance = (bountyLocation: string) => {
  // Try to parse coordinates from string
  const match = bountyLocation.match(/^(-?\d+\.?\d*),\s*(-?\d+\.?\d*)$/);
  
  if (match && location) {
    const lat = parseFloat(match[1]);
    const lng = parseFloat(match[2]);
    return calculateDistance({ latitude: lat, longitude: lng });
  }
  
  // Fallback to mock distance
  return Math.floor(Math.random() * 20) + 1;
};
```

### Address Autocomplete with Debounce

```typescript
const [query, setQuery] = useState('');
const [suggestions, setSuggestions] = useState<SavedAddress[]>([]);
const { searchAddresses } = useAddressLibrary();

useEffect(() => {
  const timer = setTimeout(async () => {
    if (query.length >= 2) {
      const results = await searchAddresses(query);
      setSuggestions(results);
    } else {
      setSuggestions([]);
    }
  }, 300); // 300ms debounce

  return () => clearTimeout(timer);
}, [query, searchAddresses]);
```

### Filter Bounties by Distance

```typescript
const { location, calculateDistance } = useLocation();
const [maxDistance, setMaxDistance] = useState<number | null>(null);

const filteredBounties = bounties.filter((bounty) => {
  // Don't filter online bounties
  if (bounty.work_type === 'online') return true;
  
  // No distance filter active
  if (!maxDistance) return true;
  
  // Calculate and compare
  if (location && bounty.location) {
    const distance = calculateDistance(parseCoords(bounty.location));
    return distance !== null && distance <= maxDistance;
  }
  
  return true;
});
```

## 🐛 Troubleshooting

### Location Permission Not Working

**Problem:** Permission dialog doesn't appear
**Solution:** 
- Check app.json for location permissions
- Restart app after code changes
- Check device location services enabled

### Addresses Not Persisting

**Problem:** Addresses disappear after app restart
**Solution:**
- Check AsyncStorage is not being cleared
- Verify addressLibraryService.initialize() is called
- Check for AsyncStorage errors in console

### Distance Calculations Incorrect

**Problem:** Distances don't make sense
**Solution:**
- Verify coordinates are in correct format (lat, lng)
- Check unit parameter ('miles' vs 'km')
- Ensure location permission is granted
- Log coordinates to verify they're correct

### Autocomplete Not Showing

**Problem:** Suggestions don't appear when typing
**Solution:**
- Check minimum 2 characters are typed
- Verify addresses exist in library
- Check search query is lowercase
- Look for errors in searchAddresses call

## 📱 Testing Tips

### Test Permission States
1. Uninstall app
2. Fresh install (permission undetermined)
3. Deny permission (test fallbacks)
4. Grant permission (test real features)
5. Revoke in settings (test recovery)

### Test Distance Calculations
1. Use fixed coordinates for testing
2. Verify Haversine formula online
3. Test edge cases (same location, poles, etc.)
4. Compare with Google Maps distances

### Test Address Library
1. Add many addresses (test performance)
2. Add long addresses (test UI overflow)
3. Add special characters (test encoding)
4. Delete all (test empty state)
5. Search with various queries (test filtering)

## 🔗 Related Files

**Services:**
- `lib/services/location-service.ts`
- `lib/services/address-library-service.ts`

**Hooks:**
- `app/hooks/useLocation.ts`
- `app/hooks/useAddressLibrary.ts`

**Components:**
- `app/tabs/location-screen.tsx`
- `app/tabs/bounty-app.tsx` (distance filtering)
- `app/screens/CreateBounty/StepLocation.tsx` (autocomplete)

**Types:**
- `lib/types.ts` (location type definitions)

**Documentation:**
- `LOCATION_FEATURES_IMPLEMENTATION.md` (detailed technical docs)
- `LOCATION_TEST_PLAN.md` (testing procedures)
- `LOCATION_FEATURES_SUMMARY.md` (overview and architecture)

## 💡 Best Practices

1. **Always check permission before using location**
2. **Provide fallbacks when permission denied**
3. **Cache location data, don't fetch constantly**
4. **Use memoization for expensive calculations**
5. **Handle errors gracefully with user-friendly messages**
6. **Respect user privacy, don't persist location**
7. **Use FlatList for long lists**
8. **Debounce search/filter operations**
9. **Show loading states during async operations**
10. **Test on real devices, not just simulators**

## 📞 Need Help?

Check these resources:
- Full implementation: `LOCATION_FEATURES_IMPLEMENTATION.md`
- Test procedures: `LOCATION_TEST_PLAN.md`
- Architecture overview: `LOCATION_FEATURES_SUMMARY.md`
- Code comments in service/hook files
- Type definitions in `lib/types.ts`
