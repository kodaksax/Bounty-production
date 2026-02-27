import { MaterialIcons } from "@expo/vector-icons";
import { useHapticFeedback } from "lib/haptic-feedback";
import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, TouchableOpacity, View } from "react-native";
import { A11Y, SIZING } from "../../lib/constants/accessibility";
import { theme } from "../../lib/theme";


export type ScreenKey = "create" | "wallet" | "bounty" | "postings" | "profile" | "admin";

interface BottomNavProps {
  activeScreen: string;
  onNavigate: (screen: ScreenKey) => void;
  showAdmin?: boolean;
  onBountyTabRepress?: () => void; // Called when bounty tab is pressed while already active
}

// Navigation icon size constants for visual hierarchy
const NAV_ICON_SIZE = 26;        // Standard nav icons
const CENTER_ICON_SIZE = 32;     // Larger center GPS icon for emphasis

export function BottomNav({ activeScreen, onNavigate, showAdmin = false, onBountyTabRepress }: BottomNavProps) {
  const centerButtonScale = useRef(new Animated.Value(1)).current;
  const centerButtonRotation = useRef(new Animated.Value(0)).current;
  const { triggerHaptic } = useHapticFeedback();

  const handleNavigate = React.useCallback((screen: ScreenKey) => {
    // If tapping the bounty button while already on bounty screen, trigger scroll-to-top + refresh
    if (screen === "bounty" && activeScreen === "bounty") {
      triggerHaptic('light'); // Light haptic for scroll-to-top action
      onBountyTabRepress?.();
      return;
    }

    if (screen === activeScreen) return;

    // Trigger haptic feedback - different types for different screens
    if (screen === "bounty") {
      triggerHaptic('medium'); // Main screen gets medium feedback
    } else {
      triggerHaptic('selection'); // Other screens get selection feedback
    }

    onNavigate(screen);
  }, [activeScreen, onNavigate, triggerHaptic, onBountyTabRepress]);

  // Animate center button when active screen changes (using standardized durations)
  useEffect(() => {
    if (activeScreen === "bounty") {
      Animated.parallel([
        Animated.timing(centerButtonScale, {
          toValue: 1.15,
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
        {/* Left side items - evenly distributed */}
        <View style={styles.sideSection}>
          <TouchableOpacity
            onPress={() => handleNavigate("create")}
            style={styles.navButton}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="Create new bounty or message"
            accessibilityState={{ selected: activeScreen === "create" }}
          >
            <MaterialIcons
              name="chat"
              color={activeScreen === "create" ? "#fffef5" : "#9ca3af"}
              size={NAV_ICON_SIZE}
            />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => handleNavigate("wallet")}
            style={styles.navButton}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="View wallet and transactions"
            accessibilityState={{ selected: activeScreen === "wallet" }}
          >
            <MaterialIcons
              name="account-balance-wallet"
              color={activeScreen === "wallet" ? "#fffef5" : "#9ca3af"}
              size={NAV_ICON_SIZE}
            />
          </TouchableOpacity>
        </View>

        {/* Center GPS button - prominently positioned in dead center */}
        <View style={styles.centerSection}>
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
              <MaterialIcons
                name="gps-fixed"
                color={activeScreen === "bounty" ? "#fffef5" : "#d1fae5"}
                size={CENTER_ICON_SIZE}
              />
            </TouchableOpacity>
          </Animated.View>
        </View>

        {/* Right side items - evenly distributed */}
        <View style={styles.sideSection}>
          <TouchableOpacity
            onPress={() => handleNavigate("postings")}
            style={styles.navButton}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="Search and browse postings"
            accessibilityState={{ selected: activeScreen === "postings" }}
          >
            <MaterialIcons
              name="edit-note"
              color={activeScreen === "postings" ? "#fffef5" : "#9ca3af"}
              size={NAV_ICON_SIZE}
            />
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
              <MaterialIcons
                name="admin-panel-settings"
                color={activeScreen === "admin" ? "#00dc50" : "#9ca3af"}
                size={NAV_ICON_SIZE}
              />
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
              <MaterialIcons
                name="person"
                color={activeScreen === "profile" ? "#fffef5" : "#9ca3af"}
                size={NAV_ICON_SIZE}
              />
            </TouchableOpacity>
          )}
        </View>
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
    justifyContent: "center", // Center the three sections
    height: 110, // Slightly reduced for cleaner mobile look
    backgroundColor: "#1a3d2e", // Primary background
    paddingHorizontal: 16, // Reduced padding for more icon space
    paddingBottom: 12,
    borderTopLeftRadius: 28, // Increased radius for modern look
    borderTopRightRadius: 28,
    ...theme.shadows.lg,
    // Enhanced glass-morphism effect
    borderWidth: 1,
    borderColor: "rgba(0, 145, 44, 0.25)", // Company specified primary green
  },

  // Left and right sections take equal space, ensuring center is dead center
  sideSection: {
    flex: 1, // Equal flex for left and right
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-evenly", // Even distribution of icons
  },
  // Center section for the prominent GPS button
  centerSection: {
    width: 80, // Fixed width for center section
    alignItems: "center",
    justifyContent: "center",
  },
  navButton: {
    padding: 12,
    borderRadius: 16,
    backgroundColor: "transparent",
    minWidth: SIZING.MIN_TOUCH_TARGET,
    minHeight: SIZING.MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -28, // Align with raised center button
  },
  centerButton: {
    height: 68, // Slightly larger for emphasis
    width: 68,
    backgroundColor: "rgba(0, 145, 44, 0.15)", // Slightly more visible background
    borderWidth: 2.5, // Thicker border for emphasis
    borderColor: "#00912C", // Company specified primary green base
    borderRadius: 34,
    alignItems: "center",
    justifyContent: "center",
    marginTop: -28, // Raised higher for more prominence
    minWidth: SIZING.MIN_TOUCH_TARGET + 24, // Larger touch target
    minHeight: SIZING.MIN_TOUCH_TARGET + 24,
    ...theme.shadows.emerald,
    overflow: 'hidden',
  },

  centerButtonInner: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 34,
  },
});
