import { MaterialIcons } from "@expo/vector-icons";
import React, { useRef, useEffect } from "react";
import { StyleSheet, TouchableOpacity, View, Animated } from "react-native";

export type ScreenKey = "create" | "wallet" | "bounty" | "postings" | "profile";

interface BottomNavProps {
  activeScreen: string;
  onNavigate: (screen: ScreenKey) => void;
}

export function BottomNav({ activeScreen, onNavigate }: BottomNavProps) {
  const centerButtonScale = useRef(new Animated.Value(1)).current;
  const centerButtonRotation = useRef(new Animated.Value(0)).current;

  // Animate center button when active screen changes
  useEffect(() => {
    if (activeScreen === "bounty") {
      Animated.parallel([
        Animated.timing(centerButtonScale, {
          toValue: 1.1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(centerButtonRotation, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(centerButtonScale, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(centerButtonRotation, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [activeScreen]);

  const rotationInterpolation = centerButtonRotation.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '90deg'],
  });

  return (
    <View style={styles.bottomNavContainer}>
      <View style={styles.bottomNav}>
        <TouchableOpacity onPress={() => onNavigate("create")} style={styles.navButton}>
          <MaterialIcons name="chat" color={activeScreen === "create" ? "#fff" : "#d1fae5"} size={24} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => onNavigate("wallet")} style={styles.navButton}>
          <MaterialIcons name="account-balance-wallet" color={activeScreen === "wallet" ? "#fff" : "#d1fae5"} size={24} />
        </TouchableOpacity>
        <Animated.View
          style={[
            styles.centerButton,
            {
              transform: [
                { scale: centerButtonScale },
                { rotate: rotationInterpolation }
              ]
            }
          ]}
        >
          <TouchableOpacity
            onPress={() => onNavigate("bounty")}
            style={styles.centerButtonInner}
          >
            <MaterialIcons name="gps-fixed" color={activeScreen === "bounty" ? "#fff" : "#d1fae5"} size={28} />
          </TouchableOpacity>
        </Animated.View>
        <TouchableOpacity onPress={() => onNavigate("postings")} style={styles.navButton}>
          <MaterialIcons name="search" color={activeScreen === "postings" ? "#fff" : "#d1fae5"} size={24} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => onNavigate("profile")} style={styles.navButton}>
          <MaterialIcons name="person" color={activeScreen === "profile" ? "#fff" : "#d1fae5"} size={24} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bottomNavContainer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: -50,
    zIndex: 100,
  },
  bottomNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    height: 120,
    backgroundColor: "#0c1115", // spy-darker
    paddingHorizontal: 28,
    paddingBottom: 8,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    elevation: 20,
    // Enhanced glass-morphism effect
    borderWidth: 1,
    borderColor: "rgba(55, 65, 81, 0.2)",
    // Add sophisticated shadow
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
  },
  navButton: {
    padding: 16,
    borderRadius: 12,
    // Add subtle hover state
    backgroundColor: "transparent",
  },
  centerButton: {
    height: 64,
    width: 64,
    backgroundColor: "rgba(16, 185, 129, 0.1)",
    borderWidth: 2,
    borderColor: "#10b981", // spy-glow
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    marginTop: -24,
    // Add sophisticated glow effect
    shadowColor: "#10b981",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 8,
    // Add backdrop blur simulation
    overflow: 'hidden',
  },
  centerButtonInner: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 32,
  },
});
