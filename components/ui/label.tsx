import * as React from "react"
import { Text, TextProps, StyleSheet } from "react-native"
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';

interface LabelProps extends TextProps {
  children?: React.ReactNode
}

const Label = React.forwardRef<Text, LabelProps>(
  ({ style, children, ...props }, ref) => {
  const { theme } = useAppThemeContext();
  const labelStyles = React.useMemo(() => makeLabelStyles(theme), [theme]);
  return ((
    <Text
      ref={ref}
      style={[labelStyles.base, style]}
      {...props}
    >
      {children}
    </Text>
  ));
}
)
Label.displayName = "Label"

function makeLabelStyles(theme: AppTheme) {
  return StyleSheet.create({
  base: {
    fontSize: 14,
    fontWeight: '500',
    color: theme.textDisabled,
    marginBottom: 4,
  },
})
}

export { Label }
