import * as React from "react"
import { TouchableOpacity, Animated, ViewProps } from "react-native"

import { cn } from "lib/utils"

interface SwitchProps extends Omit<TouchableOpacity['props'], 'onPress'> {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}

const Switch = React.forwardRef<TouchableOpacity, SwitchProps>(
  ({ className, checked = false, onCheckedChange, disabled = false, ...props }, ref) => {
    const animatedValue = React.useRef(new Animated.Value(checked ? 1 : 0)).current;

    React.useEffect(() => {
      Animated.timing(animatedValue, {
        toValue: checked ? 1 : 0,
        duration: 200,
        useNativeDriver: false,
      }).start();
    }, [checked, animatedValue]);

    const handlePress = () => {
      if (!disabled && onCheckedChange) {
        onCheckedChange(!checked);
      }
    };

    const translateX = animatedValue.interpolate({
      inputRange: [0, 1],
      outputRange: [2, 22],
    });

    const backgroundColor = animatedValue.interpolate({
      inputRange: [0, 1],
      outputRange: ['#e5e5e5', '#007AFF'],
    });

    return (
      <TouchableOpacity
        ref={ref}
        onPress={handlePress}
        disabled={disabled}
        className={cn(
          "inline-flex h-6 w-11 shrink-0 items-center rounded-full border-2 border-transparent transition-colors",
          disabled && "opacity-50",
          className
        )}
        style={{
          width: 44,
          height: 24,
          borderRadius: 12,
          padding: 2,
          justifyContent: 'center',
        }}
        {...props}
      >
        <Animated.View
          style={{
            width: 44,
            height: 24,
            borderRadius: 12,
            backgroundColor,
            position: 'absolute',
          }}
        />
        <Animated.View
          style={{
            width: 20,
            height: 20,
            borderRadius: 10,
            backgroundColor: 'white',
            shadowColor: '#000',
            shadowOffset: {
              width: 0,
              height: 2,
            },
            shadowOpacity: 0.25,
            shadowRadius: 3.84,
            elevation: 5,
            transform: [{ translateX }],
          }}
        />
      </TouchableOpacity>
    );
  }
);
Switch.displayName = "Switch";

export { Switch }
