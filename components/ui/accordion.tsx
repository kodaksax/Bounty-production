import * as React from "react"
import { View, Text, TouchableOpacity, LayoutAnimation, Platform, UIManager, ViewProps, TextProps } from "react-native"
import { MaterialIcons } from "@expo/vector-icons"
import { cn } from "lib/utils"

// Enable LayoutAnimation on Android
if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface AccordionItemProps extends ViewProps {
  value: string;
  className?: string;
}

interface AccordionContextValue {
  activeItems: string[];
  toggleItem: (value: string) => void;
  type?: "single" | "multiple";
}

const AccordionContext = React.createContext<AccordionContextValue | null>(null);

interface AccordionProps extends ViewProps {
  type?: "single" | "multiple";
  defaultValue?: string | string[];
  value?: string | string[];
  onValueChange?: (value: string | string[]) => void;
  collapsible?: boolean;
  className?: string;
}

const Accordion = React.forwardRef<View, AccordionProps>(
  ({ children, type = "single", defaultValue, value, onValueChange, collapsible = false, className, ...props }, ref) => {
    const [activeItems, setActiveItems] = React.useState<string[]>(() => {
      if (value !== undefined) {
        return Array.isArray(value) ? value : [value];
      }
      if (defaultValue !== undefined) {
        return Array.isArray(defaultValue) ? defaultValue : [defaultValue];
      }
      return [];
    });

    React.useEffect(() => {
      if (value !== undefined) {
        setActiveItems(Array.isArray(value) ? value : [value]);
      }
    }, [value]);

    const toggleItem = React.useCallback((itemValue: string) => {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      
      setActiveItems(current => {
        let newActiveItems: string[];
        
        if (type === "single") {
          if (current.includes(itemValue)) {
            newActiveItems = collapsible ? [] : current;
          } else {
            newActiveItems = [itemValue];
          }
        } else {
          if (current.includes(itemValue)) {
            newActiveItems = current.filter(item => item !== itemValue);
          } else {
            newActiveItems = [...current, itemValue];
          }
        }

        if (onValueChange) {
          onValueChange(type === "single" ? newActiveItems[0] || "" : newActiveItems);
        }
        
        return newActiveItems;
      });
    }, [type, collapsible, onValueChange]);

    const contextValue = React.useMemo(() => ({
      activeItems,
      toggleItem,
      type
    }), [activeItems, toggleItem, type]);

    return (
      <AccordionContext.Provider value={contextValue}>
        <View ref={ref} className={cn("", className)} {...props}>
          {children}
        </View>
      </AccordionContext.Provider>
    );
  }
);
Accordion.displayName = "Accordion";

const AccordionItem = React.forwardRef<View, AccordionItemProps>(
  ({ className, value, children, ...props }, ref) => (
    <View
      ref={ref}
      className={cn("border-b border-gray-200", className)}
      {...props}
    >
      {React.Children.map(children, child => 
        React.isValidElement(child) 
          ? React.cloneElement(child, { value } as any)
          : child
      )}
    </View>
  )
);
AccordionItem.displayName = "AccordionItem";

interface AccordionTriggerProps extends Omit<TouchableOpacity['props'], 'onPress'> {
  value?: string;
  className?: string;
}

const AccordionTrigger = React.forwardRef<TouchableOpacity, AccordionTriggerProps>(
  ({ className, children, value, ...props }, ref) => {
    const context = React.useContext(AccordionContext);
    
    if (!context) {
      throw new Error("AccordionTrigger must be used within an Accordion");
    }

    const { activeItems, toggleItem } = context;
    const isOpen = value ? activeItems.includes(value) : false;

    return (
      <TouchableOpacity
        ref={ref}
        onPress={() => value && toggleItem(value)}
        className={cn(
          "flex flex-row items-center justify-between py-4 px-0",
          className
        )}
        {...props}
      >
        <Text className="font-medium text-base flex-1">{children}</Text>
        <MaterialIcons
          name="keyboard-arrow-down"
          size={20}
          color="#666"
          style={{
            transform: [{ rotate: isOpen ? "180deg" : "0deg" }],
          }}
        />
      </TouchableOpacity>
    );
  }
);
AccordionTrigger.displayName = "AccordionTrigger";

interface AccordionContentProps extends ViewProps {
  value?: string;
  className?: string;
}

const AccordionContent = React.forwardRef<View, AccordionContentProps>(
  ({ className, children, value, ...props }, ref) => {
    const context = React.useContext(AccordionContext);
    
    if (!context) {
      throw new Error("AccordionContent must be used within an Accordion");
    }

    const { activeItems } = context;
    const isOpen = value ? activeItems.includes(value) : false;

    if (!isOpen) {
      return null;
    }

    return (
      <View
        ref={ref}
        className={cn("pb-4 pt-0", className)}
        {...props}
      >
        {children}
      </View>
    );
  }
);
AccordionContent.displayName = "AccordionContent";

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent }
