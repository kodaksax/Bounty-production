import { MaterialIcons } from "@expo/vector-icons";
import { useHapticFeedback } from "lib/haptic-feedback";
import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, TouchableOpacity, View } from "react-native";
import { A11Y, SIZING, COLORS, SHADOWS, RADIUS } from "../../lib/constants/accessibility";

export type ScreenKey = "create" | "wallet" | "bounty" | "postings" | "profile" | "admin";

interface BottomNavProps {
  activeScreen: string;
  onNavigate: (screen: ScreenKey) => void;
  showAdmin?: boolean;
}

export function BottomNav({ activeScreen, onNavigate, showAdmin = false }: BottomNavProps) {
  const centerButtonScale = useRef(new Animated.Value(1)).current;
  const centerButtonRotation = useRef(new Animated.Value(0)).current;
  const { triggerHaptic } = useHapticFeedback();

  const handleNavigate = React.useCallback((screen: ScreenKey) => {
    if (screen === activeScreen) return;
    
    // Trigger haptic feedback - different types for different screens
    if (screen === "bounty") {
      triggerHaptic('medium'); // Main screen gets medium feedback
    } else {
      triggerHaptic('selection'); // Other screens get selection feedback
    }
    
    onNavigate(screen);
  }, [activeScreen, onNavigate, triggerHaptic]);

  // Animate center button when active screen changes (using standardized durations)
  useEffect(() => {
    if (activeScreen === "bounty") {
      Animated.parallel([
        Animated.timing(centerButtonScale, {
          toValue: 1.1,
          duration: A11Y.ANIMATION_NORMAL,
          useNativeDriver: true,
        }),
        Animated.timing(centerButtonRotation, {
          toValue: 1,
          duration: A11Y.ANIMATION_NORMAL,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(centerButtonScale, {
          toValue: 1,
          duration: A11Y.ANIMATION_NORMAL,
          useNativeDriver: true,
        }),
        Animated.timing(centerButtonRotation, {
          toValue: 0,
          duration: A11Y.ANIMATION_NORMAL,
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
        <TouchableOpacity 
          onPress={() => handleNavigate("create")} 
          style={styles.navButton}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel="Create new bounty or message"
          accessibilityState={{ selected: activeScreen === "create" }}
        >
          <MaterialIcons name="chat" color={activeScreen === "create" ? "#fffef5" : "#c3c3c4"} size={24} />
        </TouchableOpacity>
        <TouchableOpacity 
          onPress={() => handleNavigate("wallet")} 
          style={styles.navButton}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel="View wallet and transactions"
          accessibilityState={{ selected: activeScreen === "wallet" }}
        >
          <MaterialIcons name="account-balance-wallet" color={activeScreen === "wallet" ? "#fffef5" : "#c3c3c4"} size={24} />
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
            onPress={() => handleNavigate("bounty")}
            style={styles.centerButtonInner}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="View bounty dashboard - Main screen"
            accessibilityState={{ selected: activeScreen === "bounty" }}
            accessibilityHint="This is the main screen with available bounties"
          >
            <MaterialIcons name="gps-fixed" color={activeScreen === "bounty" ? "#fffef5" : "#c3c3c4"} size={28} />
          </TouchableOpacity>
        </Animated.View>
        <TouchableOpacity 
          onPress={() => handleNavigate("postings")} 
          style={styles.navButton}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel="Search and browse postings"
          accessibilityState={{ selected: activeScreen === "postings" }}
        >
          {/* Container sized slightly larger (no border) so the icon aligns with nearby profile icon touch target */}
          <View style={styles.navIconContainer}>
            <MaterialIcons name="edit-note" color={activeScreen === "postings" ? "#fffef5" : "#c3c3c4"} size={28} />
          </View>
        </TouchableOpacity>
        {showAdmin ? (
          <TouchableOpacity 
            onPress={() => handleNavigate("admin")} 
            style={styles.navButton}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="Admin panel"
            accessibilityState={{ selected: activeScreen === "admin" }}
          >
            <MaterialIcons name="admin-panel-settings" color={activeScreen === "admin" ? "#00dc50" : "#c3c3c4"} size={28} />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity 
            onPress={() => handleNavigate("profile")} 
            style={styles.navButton}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="View and edit profile"
            accessibilityState={{ selected: activeScreen === "profile" }}
          >
            <MaterialIcons name="person" color={activeScreen === "profile" ? "#fffef5" : "#c3c3c4"} size={28} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bottomNavContainer: {
    position: "absolute",
    left: 0,
    right: 0,
  // Float partially off-screen for layered effect while remaining visually fixed
  bottom: -50,
    zIndex: 100,
  },
  bottomNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
  height: 120,
    backgroundColor: "#1a3d2e", // Updated to use new primary background
    paddingHorizontal: 28,
    paddingBottom: 8,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    elevation: 20,
    // Enhanced glass-morphism effect
    borderWidth: 1,
    borderColor: "rgba(0, 145, 44, 0.25)", // Updated to use company specified primary green
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
    minWidth: SIZING.MIN_TOUCH_TARGET,
    minHeight: SIZING.MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerButton: {
    height: 64,
    width: 64,
    backgroundColor: "rgba(0, 145, 44, 0.1)", // Updated to use company specified primary green
    borderWidth: 2,
    borderColor: "#00912C", // Company specified primary green base
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    marginTop: -24,
    minWidth: SIZING.MIN_TOUCH_TARGET + 20, // Center button is larger
    minHeight: SIZING.MIN_TOUCH_TARGET + 20,
    // Add sophisticated glow effect
    shadowColor: "#00912C", // Company specified primary green base
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
    borderRadius: RADIUS.FULL,
  },
  navIconContainer: {
    // Slightly larger touch target matching other nav buttons but without a visible border
    width: SIZING.MIN_TOUCH_TARGET,
    height: SIZING.MIN_TOUCH_TARGET,
    padding: 10,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: SIZING.MIN_TOUCH_TARGET,
    minHeight: SIZING.MIN_TOUCH_TARGET,
    borderRadius: 12,
    backgroundColor: 'transparent',
  },
});
