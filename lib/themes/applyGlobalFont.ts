// Applies the app typeface (Inter) to every React Native <Text> and
// <TextInput> without touching each screen.
//
// React 19 ignores defaultProps on function components, so instead we swap
// the module's default export for a thin wrapper. `react-native`'s index
// re-reads `require('./Libraries/Text/Text').default` on every `Text` access,
// so all `import { Text } from 'react-native'` call sites pick it up.
//
// Elements that set their own fontFamily (icon fonts, monospace) are left
// alone; otherwise fontWeight is mapped to the matching Inter face, since
// custom fonts don't synthesize bold.
import React from 'react';
import { StyleSheet } from 'react-native';
import { fontForWeight } from './tokens';

function withAppFont(Base: any) {
  function AppFontText(props: any) {
    const flat = StyleSheet.flatten(props.style) || {};
    if (flat.fontFamily) return React.createElement(Base, props);
    const style = [props.style, { fontFamily: fontForWeight(flat.fontWeight), fontWeight: undefined }];
    return React.createElement(Base, { ...props, style });
  }
  AppFontText.displayName = Base.displayName || 'Text';
  // Preserve statics (e.g. TextInput.State)
  Object.keys(Base).forEach(k => {
    if (!(k in AppFontText)) (AppFontText as any)[k] = Base[k];
  });
  return AppFontText;
}

let applied = false;

export function applyGlobalFont() {
  if (applied) return;
  applied = true;
  try {
    const textModule = require('react-native/Libraries/Text/Text');
    textModule.default = withAppFont(textModule.default);
    const inputModule = require('react-native/Libraries/Components/TextInput/TextInput');
    inputModule.default = withAppFont(inputModule.default);
  } catch {
    // Non-native environments (web, jest mocks) keep the platform default.
  }
}
