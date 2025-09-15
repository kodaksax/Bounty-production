import * as React from "react"
import { View, TouchableOpacity, ViewProps } from "react-native"
import { MaterialIcons } from "@expo/vector-icons"

import { cn } from "lib/utils"

interface CheckboxProps extends Omit<TouchableOpacity['props'], 'onPress'> {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}

const Checkbox = React.forwardRef<TouchableOpacity, CheckboxProps>(
  ({ className, checked = false, onCheckedChange, disabled = false, ...props }, ref) => {
    const handlePress = () => {
      if (!disabled && onCheckedChange) {
        onCheckedChange(!checked);
      }
    };

    return (
      <TouchableOpacity
        ref={ref}
        onPress={handlePress}
        disabled={disabled}
        className={cn(
          "h-4 w-4 shrink-0 rounded border border-primary items-center justify-center",
          checked && "bg-primary",
          disabled && "opacity-50",
          className
        )}
        style={{
          width: 16,
          height: 16,
          borderWidth: 1,
          borderColor: checked ? '#007AFF' : '#999',
          backgroundColor: checked ? '#007AFF' : 'transparent',
          borderRadius: 2,
          alignItems: 'center',
          justifyContent: 'center',
        }}
        {...props}
      >
        {checked && (
          <MaterialIcons 
            name="check" 
            size={12} 
            color="white" 
          />
        )}
      </TouchableOpacity>
    );
  }
);
Checkbox.displayName = "Checkbox";

export { Checkbox }
