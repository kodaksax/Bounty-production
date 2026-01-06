// Jest setup file for global test configuration


// Mock environment variables for tests
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_ANON_KEY = 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.STRIPE_SECRET_KEY = 'sk_test_mock_key';
process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_mock_key';
process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_mock_key';
process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY = 'test-api-key-12345';
process.env.NODE_ENV = 'test';

// Define __DEV__ global for React Native code
global.__DEV__ = true;

// Global test timeout - increased for async operations
jest.setTimeout(30000);

// Mock expo-constants
jest.mock('expo-constants', () => ({
  default: {
    expoConfig: {
      extra: {
        googlePlacesApiKey: 'test-api-key-12345',
      },
    },
    manifest: {},
  },
}));

// Mock EventEmitter for React Native modules
class MockEventEmitter {
  constructor() {
    this.listeners = {};
  }
  
  addListener(event, callback) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(callback);
    return { remove: () => this.removeListener(event, callback) };
  }
  
  removeListener(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
    }
  }
  
  emit(event, ...args) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(callback => callback(...args));
    }
  }
  
  removeAllListeners(event) {
    if (event) {
      delete this.listeners[event];
    } else {
      this.listeners = {};
    }
  }
}

global.EventEmitter = MockEventEmitter;

// Mock React Native modules that aren't available in Node.js test environment
jest.mock('react-native', () => {
  const EventEmitter = global.EventEmitter;
  return {
    AccessibilityInfo: {
      isReduceMotionEnabled: jest.fn().mockResolvedValue(false),
      addEventListener: jest.fn().mockReturnValue({ remove: jest.fn() }),
    },
    Platform: {
      OS: 'ios',
      select: jest.fn((obj) => obj.ios || obj.default),
    },
    StyleSheet: {
      create: (styles) => styles,
      flatten: (style) => style,
    },
    Animated: {
      Value: jest.fn().mockImplementation((value) => ({ 
        _value: value,
        setValue: jest.fn(),
        interpolate: jest.fn().mockReturnValue(value),
      })),
      timing: jest.fn().mockReturnValue({ start: jest.fn() }),
      spring: jest.fn().mockReturnValue({ start: jest.fn() }),
      loop: jest.fn().mockReturnValue({ start: jest.fn(), stop: jest.fn() }),
      sequence: jest.fn().mockReturnValue({ start: jest.fn() }),
      parallel: jest.fn().mockReturnValue({ start: jest.fn() }),
      createAnimatedComponent: jest.fn((component) => component),
      View: 'Animated.View',
    },
    Dimensions: {
      get: jest.fn().mockReturnValue({ width: 375, height: 812 }),
    },
    NativeModules: {
      StatusBarManager: {
        HEIGHT: 20,
        addListener: jest.fn(),
        removeListeners: jest.fn(),
      },
    },
    NativeEventEmitter: EventEmitter,
    View: 'View',
    Text: 'Text',
    TouchableOpacity: 'TouchableOpacity',
    TextInput: 'TextInput',
    ScrollView: 'ScrollView',
    FlatList: 'FlatList',
    ActivityIndicator: 'ActivityIndicator',
  };
});

// Mock expo-haptics
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  selectionAsync: jest.fn(),
  ImpactFeedbackStyle: {
    Light: 'Light',
    Medium: 'Medium',
    Heavy: 'Heavy',
    Soft: 'Soft',
    Rigid: 'Rigid',
  },
  NotificationFeedbackType: {
    Success: 'Success',
    Warning: 'Warning',
    Error: 'Error',
  },
}));

// Mock expo-secure-store
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

// Mock react-native-url-polyfill
jest.mock('react-native-url-polyfill/auto', () => ({}));

// Mock @react-native-community/netinfo
jest.mock('@react-native-community/netinfo', () => ({
  fetch: jest.fn().mockResolvedValue({
    isConnected: true,
    isInternetReachable: true,
    type: 'wifi',
    details: null,
  }),
  addEventListener: jest.fn().mockReturnValue(() => {}),
}));

// Mock @react-native-async-storage/async-storage
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
  removeItem: jest.fn().mockResolvedValue(undefined),
  multiGet: jest.fn().mockResolvedValue([]),
  multiSet: jest.fn().mockResolvedValue(undefined),
  multiRemove: jest.fn().mockResolvedValue(undefined),
  clear: jest.fn().mockResolvedValue(undefined),
  getAllKeys: jest.fn().mockResolvedValue([]),
}));

// Mock @stripe/stripe-react-native
// Simulates SDK unavailability in test environment (expected in non-native environments)
// Individual tests can override these mocks as needed for their specific scenarios
jest.mock('@stripe/stripe-react-native', () => ({
  initStripe: jest.fn().mockRejectedValue(new Error('SDK not available in test environment')),
  createPaymentMethod: jest.fn(),
  confirmPayment: jest.fn(),
  initPaymentSheet: jest.fn(),
  presentPaymentSheet: jest.fn(),
  handleNextAction: jest.fn(),
}));

// Mock @sentry/react-native
jest.mock('@sentry/react-native', () => ({
  init: jest.fn(),
  captureException: jest.fn(),
  captureMessage: jest.fn(),
  addBreadcrumb: jest.fn(),
  setUser: jest.fn(),
  setContext: jest.fn(),
  setTag: jest.fn(),
  setExtra: jest.fn(),
  withScope: jest.fn((callback) => callback({ setTag: jest.fn(), setExtra: jest.fn() })),
  configureScope: jest.fn((callback) => callback({ setTag: jest.fn(), setExtra: jest.fn() })),
}));

// Mock mixpanel-react-native
jest.mock('mixpanel-react-native', () => ({
  Mixpanel: {
    init: jest.fn().mockResolvedValue(undefined),
    track: jest.fn(),
    identify: jest.fn(),
    setProfile: jest.fn(),
    timeEvent: jest.fn(),
    flush: jest.fn(),
    reset: jest.fn(),
  },
}));

// Mock expo-modules-core
jest.mock('expo-modules-core', () => ({
  EventEmitter: class MockEventEmitter {
    constructor() {
      this.listeners = {};
    }
    
    addListener(event, callback) {
      if (!this.listeners[event]) {
        this.listeners[event] = [];
      }
      this.listeners[event].push(callback);
      return { remove: () => this.removeListener(event, callback) };
    }
    
    removeListener(event, callback) {
      if (this.listeners[event]) {
        this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
      }
    }
    
    emit(event, ...args) {
      if (this.listeners[event]) {
        this.listeners[event].forEach(callback => callback(...args));
      }
    }
    
    removeAllListeners(event) {
      if (event) {
        delete this.listeners[event];
      } else {
        this.listeners = {};
      }
    }
  },
  requireNativeModule: jest.fn(() => ({})),
  NativeModulesProxy: {},
}));

// Mock expo-file-system (including legacy export)
jest.mock('expo-file-system', () => ({
  documentDirectory: '/mock/documents/',
  cacheDirectory: '/mock/cache/',
  writeAsStringAsync: jest.fn().mockResolvedValue(undefined),
  readAsStringAsync: jest.fn().mockResolvedValue(''),
  deleteAsync: jest.fn().mockResolvedValue(undefined),
  EncodingType: {
    UTF8: 'utf8',
    Base64: 'base64',
  },
}));

// Mock expo-file-system/legacy
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: '/mock/documents/',
  cacheDirectory: '/mock/cache/',
  writeAsStringAsync: jest.fn().mockResolvedValue(undefined),
  readAsStringAsync: jest.fn().mockResolvedValue(''),
  deleteAsync: jest.fn().mockResolvedValue(undefined),
  EncodingType: {
    UTF8: 'utf8',
    Base64: 'base64',
  },
}));

// Mock expo-sharing
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn().mockResolvedValue(true),
  shareAsync: jest.fn().mockResolvedValue(undefined),
}));

// Mock console methods to reduce noise in tests, but preserve critical errors
const originalError = console.error;
global.console = {
  ...console,
  error: (...args) => {
    // Convert first argument to string for pattern matching
    const firstArg = args[0]?.toString() || '';
    
    // Only suppress specific known noisy errors from test error paths
    if (
      firstArg.includes('DeprecationWarning') ||
      firstArg.includes('Some known noisy error') ||
      firstArg.includes('[StripeService]') ||
      firstArg.includes('[phone-verification]') ||
      firstArg.includes('[auth-service]') ||
      firstArg.includes('[authProfileService]') ||
      firstArg.includes('[AuthSessionStorage]') ||
      firstArg.includes('[portfolio-service]') ||
      firstArg.includes('Error getting permission status')
    ) {
      return;
    }
    originalError(...args);
  },
  warn: jest.fn(),
  log: jest.fn(),
};
