
import * as React from "react";
import { GestureResponderEvent, StyleSheet, TouchableOpacity, View, Text } from "react-native";
import { Tooltip } from "react-native-paper";

type HoverCardProps = {
  title: React.ReactNode; // Accepts string or JSX
  // ...other props...
};

const HoverCard: React.FC<HoverCardProps> = ({ title, ...props }) => (
  <View>
    {/* Render title */}
    {typeof title === "string" ? (
      <Text>{title}</Text>
    ) : (
      title
    )}
    {/* ...other content... */}
  </View>
);


type HoverCardTriggerProps = {
  children: React.ReactNode;
  onPress?: (event: GestureResponderEvent) => void;
  style?: any;
};
const HoverCardTrigger = React.forwardRef<View, HoverCardTriggerProps>(
  ({ children, ...props }, ref) => (
    <TouchableOpacity ref={ref as React.RefObject<View>} {...props}>
      {children}
    </TouchableOpacity>
  )
);
HoverCardTrigger.displayName = "HoverCardTrigger";

type HoverCardContentProps = {
  children: React.ReactNode;
  style?: any;
};
const HoverCardContent = ({ children, style }: HoverCardContentProps) => (
  <View style={[styles.content, style]}>
    {children}
  </View>
);
HoverCardContent.displayName = "HoverCardContent";

const styles = StyleSheet.create({
  content: {
    width: 256,
    borderRadius: 8,
    backgroundColor: '#fff',
    padding: 16,
  },
});

export { HoverCard, HoverCardContent, HoverCardTrigger };

