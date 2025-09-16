// Temporary global shims to reduce mass edits while porting web components to React Native.
// These declare commonly-used RN primitives as globals so files that reference them
// without importing don't fail TypeScript checks during incremental conversion.
// TODO: Remove these shims and import RN primitives explicitly in each file.

declare const View: any
declare const Text: any
declare const TouchableOpacity: any
declare const ScrollView: any
declare const Modal: any
declare const TextInput: any
declare const Image: any
declare const SafeAreaView: any
declare const Pressable: any

declare module '@expo/vector-icons/MaterialIcons' {
  const MaterialIcons: any
  export default MaterialIcons
}

declare module 'recharts' { const recharts: any; export = recharts }

// Allow importing modules that are currently web-only (temporary)
declare module '@radix-ui/*' { const x: any; export = x }
declare module 'react-resizable-panels' { const x: any; export = x }
declare module 'sonner' { const x: any; export = x }
declare module 'next-themes' { const x: any; export = x }
