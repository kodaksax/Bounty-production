// Jest setup file for global test configuration

// Mock environment variables for tests
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_ANON_KEY = 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.STRIPE_SECRET_KEY = 'sk_test_mock_key';
process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_mock_key';
process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_mock_key';
process.env.NODE_ENV = 'test';

// Global test timeout
jest.setTimeout(10000);

// Mock expo-constants
jest.mock('expo-constants', () => ({
  default: {
    expoConfig: {
      extra: {},
    },
    manifest: {},
  },
}));

// Mock React Native modules that aren't available in Node.js test environment
jest.mock('react-native', () => ({
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
  NativeModules: {},
  View: 'View',
  Text: 'Text',
  TouchableOpacity: 'TouchableOpacity',
  TextInput: 'TextInput',
  ScrollView: 'ScrollView',
  FlatList: 'FlatList',
  ActivityIndicator: 'ActivityIndicator',
}));

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

// Mock @stripe/stripe-react-native
jest.mock('@stripe/stripe-react-native', () => ({
  initStripe: jest.fn().mockResolvedValue(undefined),
  createPaymentMethod: jest.fn(),
  confirmPayment: jest.fn(),
  initPaymentSheet: jest.fn(),
  presentPaymentSheet: jest.fn(),
  handleNextAction: jest.fn(),
}));

// Mock console methods to reduce noise in tests, but preserve critical errors
const originalError = console.error;
global.console = {
  ...console,
  error: (...args) => {
    // Only suppress specific known noisy errors (customize as needed)
    if (
      typeof args[0] === 'string' &&
      (
        args[0].includes('DeprecationWarning') ||
        args[0].includes('Some known noisy error')
      )
    ) {
      return;
    }
    originalError(...args);
  },
  warn: jest.fn(),
  log: jest.fn(),
};
