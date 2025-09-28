import { MaterialIcons } from "@expo/vector-icons";
import * as React from "react";
import { Text, TouchableOpacity, View } from "react-native";


const Breadcrumb: React.FC<{ children?: React.ReactNode; separator?: React.ReactNode }> = ({ children }) => (
  <View>{children}</View>
)

const BreadcrumbList = React.forwardRef<View, { children?: React.ReactNode }>((props, ref) => (
  <View ref={ref} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }} {...(props as any)}>
    {props.children}
  </View>
))
BreadcrumbList.displayName = "BreadcrumbList"

const BreadcrumbItem = React.forwardRef<View, { children?: React.ReactNode }>((props, ref) => (
  <View ref={ref} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }} {...(props as any)}>
    {props.children}
  </View>
))
BreadcrumbItem.displayName = "BreadcrumbItem"

const BreadcrumbLink = React.forwardRef<
  React.ElementRef<typeof TouchableOpacity>,
  React.ComponentPropsWithoutRef<typeof TouchableOpacity>
>((props, ref) => (
  <TouchableOpacity ref={ref as any} {...(props as any)}>
    {props.children}
  </TouchableOpacity>
))
BreadcrumbLink.displayName = "BreadcrumbLink"

const BreadcrumbText = React.forwardRef<Text, { children?: React.ReactNode }>((props, ref) => (
  <Text ref={ref as any} {...(props as any)}>{props.children}</Text>
))
BreadcrumbText.displayName = "BreadcrumbText"

const BreadcrumbSeparator: React.FC<{ children?: React.ReactNode }> = ({ children }) => (
  <View>{children ?? <MaterialIcons name="keyboard-arrow-right" size={20} color="#fffef5" />}</View>
)

export { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbSeparator, BreadcrumbText };

