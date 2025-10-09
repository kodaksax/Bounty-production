import * as React from "react";
import type { TouchableOpacityProps } from "react-native";
import { Animated, TouchableOpacity } from "react-native";

import { cn } from "lib/utils";

interface SwitchProps extends Omit<TouchableOpacityProps, 'onPress'> {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}

const Switch = React.forwardRef<any, SwitchProps>(
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
      outputRange: [2, 26], // Adjusted for larger switch
    });

    const backgroundColor = animatedValue.interpolate({
      inputRange: [0, 1],
      outputRange: ['rgba(55, 65, 81, 0.6)', '#00912C'], // gray to emerald-600
    });

    const thumbShadow = animatedValue.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 0.4],
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
          width: 50,
          height: 28,
          borderRadius: 14,
          padding: 2,
          justifyContent: 'center',
        }}
        {...props}
      >
        <Animated.View
          style={{
            width: 50,
            height: 28,
            borderRadius: 14,
            backgroundColor,
            position: 'absolute',
            // Add glass-morphism border
            borderWidth: 1,
            borderColor: 'rgba(255, 255, 255, 0.1)',
          }}
        />
        <Animated.View
          style={{
            width: 22,
            height: 22,
            borderRadius: 11,
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
            // Add dynamic glow based on state
            borderWidth: checked ? 2 : 1,
            borderColor: checked ? 'rgba(0, 145, 44, 0.3)' : 'rgba(0, 0, 0, 0.1)', // emerald-600 glow when checked
          }}
        />
      </TouchableOpacity>
    );
  }
);
Switch.displayName = "Switch";

export { Switch };

