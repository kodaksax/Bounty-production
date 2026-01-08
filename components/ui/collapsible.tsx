import React, { useState } from "react";
import { View, TouchableOpacity, Text } from "react-native";
import Collapsible from "react-native-collapsible";

export interface CollapsibleProps {
  title: string;
  children: React.ReactNode;
  collapsed?: boolean;
}

export const CollapsibleSection: React.FC<CollapsibleProps> = ({
  title,
  children,
  collapsed: collapsedProp = true,
}) => {
  const [collapsed, setCollapsed] = useState(collapsedProp);

  return (
    <View>
      <TouchableOpacity accessibilityRole="button" onPress={() => setCollapsed(!collapsed)}>
        <Text>{title}</Text>
      </TouchableOpacity>
      <Collapsible collapsed={collapsed}>
        <View>{children}</View>
      </Collapsible>
    </View>
  );
};
