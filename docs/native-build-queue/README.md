# Native build queue

Changes that are ready but must ride along with the **next native build**,
because they change the runtime fingerprint. Anything in `patches/` is a
fingerprint input (see `fingerprint.config.js`); moving a file there blocks OTA
updates to every binary already installed until a new build ships. Files in
this folder are not applied and not fingerprinted.

## react-native+0.83.10.patch — press dim for every TouchableOpacity

React Native's `TouchableOpacity` dims to 20% opacity on press when no
`activeOpacity` is passed. About 1,800 touchables in this app rely on that
default, so most rows and icons blink nearly transparent on tap. React 19
removed `defaultProps` for function components, so there is no JS-only way to
change the default globally. This patch changes it to 0.7, the app's
`press.opacity` token (`lib/motion.ts`). Touchables that pass their own
`activeOpacity` are unaffected.

### Applying it (in the same PR that cuts the native build)

1. `git mv docs/native-build-queue/react-native+0.83.10.patch patches/`
2. `npm install` (postinstall runs patch-package). Confirm
   `node_modules/react-native/Libraries/Components/Touchable/TouchableOpacity.js`
   reads `this.props.activeOpacity ?? 0.7`.
3. If react-native was upgraded since 0.83.10, regenerate instead: edit that
   line in node_modules and run `npx patch-package react-native`.
4. Keep the patch LF-only (a CRLF copy changes the fingerprint on Windows
   checkouts; see the fingerprint CRLF note in docs).
5. Tap through the tab bar, a settings list and a header back button on iOS
   and Android. Each should dim gently instead of blinking.

Ship it only alongside a native build: an OTA cannot carry it.
