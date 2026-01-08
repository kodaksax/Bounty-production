"use client"

import * as React from "react";
import { Animated, Dimensions, StyleProp, StyleSheet, TouchableWithoutFeedback, View, ViewStyle, Text } from "react-native";

type DrawerProps = {
  visible: boolean;
  onClose: () => void;
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

const SCREEN_HEIGHT = Dimensions.get('window').height;

const Drawer: React.FC<DrawerProps> = ({ visible, onClose, children, style }) => {
  const translateY = React.useRef(new Animated.Value(SCREEN_HEIGHT)).current;

  React.useEffect(() => {
    if (visible) {
      Animated.timing(translateY, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(translateY, {
        toValue: SCREEN_HEIGHT,
        duration: 300,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, translateY]);

  if (!visible) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <TouchableWithoutFeedback accessibilityRole="button" onPress={onClose}>
        <View style={styles.overlay} />
      </TouchableWithoutFeedback>
      <Animated.View style={[styles.content, style, { transform: [{ translateY }] }]}> 
        <View style={styles.handle} />
        {children}
      </Animated.View>
    </View>
  );
};
Drawer.displayName = "Drawer";

// DrawerTrigger, DrawerPortal, DrawerClose are not needed in React Native

type DrawerOverlayProps = {
  style?: StyleProp<ViewStyle>;
  [key: string]: any;
};
const DrawerOverlay: React.FC<DrawerOverlayProps> = ({ style, ...props }) => (
  <View style={[styles.overlay, style]} {...props} />
);
DrawerOverlay.displayName = "DrawerOverlay";

type DrawerContentProps = {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  [key: string]: any;
};
const DrawerContent: React.FC<DrawerContentProps> = ({ children, style, ...props }) => (
  <View style={[styles.content, style]} {...props}>
    <View style={styles.handle} />
    {children}
  </View>
);
DrawerContent.displayName = "DrawerContent";

type DrawerHeaderProps = {
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
  [key: string]: any;
};
const DrawerHeader: React.FC<DrawerHeaderProps> = ({ style, children, ...props }) => (
  <View style={[styles.header, style]} {...props}>
    {children}
  </View>
);
DrawerHeader.displayName = "DrawerHeader";

type DrawerFooterProps = {
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
  [key: string]: any;
};
const DrawerFooter: React.FC<DrawerFooterProps> = ({ style, children, ...props }) => (
  <View style={[styles.footer, style]} {...props}>
    {children}
  </View>
);
DrawerFooter.displayName = "DrawerFooter";

type DrawerTitleProps = {
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
  [key: string]: any;
};
const DrawerTitle: React.FC<DrawerTitleProps> = ({ style, children, ...props }) => (
  <View style={style as StyleProp<ViewStyle> | undefined} {...props}>
    {children}
  </View>
);
DrawerTitle.displayName = "DrawerTitle";

type DrawerDescriptionProps = {
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
  [key: string]: any;
};

const DrawerDescription: React.FC<DrawerDescriptionProps> = ({ style, children, ...props }) => (
  <View style={{ padding: 10 }}>
  <Text style={{ fontSize: 16, color: "#333" }}>
    Drawer content goes here
  </Text>
</View>
);
DrawerDescription.displayName = "DrawerDescription";

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.8)',
    zIndex: 50,
  },
  content: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 50,
    marginTop: 24,
    flexDirection: 'column',
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
    backgroundColor: '#fff', // Replace with theme if needed
    borderWidth: 1,
    borderColor: '#eee',
    minHeight: 100,
  },
  handle: {
    alignSelf: 'center',
    marginTop: 4,
    height: 2,
    width: 100,
    borderRadius: 999,
    backgroundColor: '#ccc', // Replace with theme if needed
  },
  header: {
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    marginTop: 'auto',
    flexDirection: 'column',
    gap: 8,
    padding: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  description: {
    fontSize: 14,
    color: '#888', // Replace with theme if needed
  },
});

export {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerOverlay,
  DrawerTitle
};

