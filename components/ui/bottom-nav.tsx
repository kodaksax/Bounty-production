import { MaterialIcons } from "@expo/vector-icons";
import { useHapticFeedback } from "lib/haptic-feedback";
import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { A11Y, SIZING } from "../../lib/constants/accessibility";
import { theme as legacyTheme } from "../../lib/theme";
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';


export type ScreenKey = "messages" | "wallet" | "bounty" | "postings" | "profile" | "admin";

interface BottomNavProps {
  activeScreen: string;
  onNavigate: (screen: ScreenKey) => void;
  showAdmin?: boolean;
  onBountyTabRepress?: () => void; // Called when bounty tab is pressed while already active
  unreadMessageCount?: number; // Total unread message count badge for the chat icon
}

// Navigation icon size constants for visual hierarchy
const NAV_ICON_SIZE = 26;        // Standard nav icons
const CENTER_ICON_SIZE = 32;     // Larger center GPS icon for emphasis

export function BottomNav({ activeScreen, onNavigate, showAdmin = false, onBountyTabRepress, unreadMessageCount = 0 }: BottomNavProps) {
  const centerButtonScale = useRef(new Animated.Value(1)).current;
  const centerButtonRotation = useRef(new Animated.Value(0)).current;
  const { triggerHaptic } = useHapticFeedback();
  const { theme } = useAppThemeContext();
  const styles = makeStyles(theme);

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
            onPress={() => handleNavigate("messages")}
            style={styles.navButton}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel={unreadMessageCount > 0 ? `Messages, ${unreadMessageCount} unread` : "Create new bounty or message"}
            accessibilityState={{ selected: activeScreen === "messages" }}
          >
            <View style={styles.iconWrapper}>
              <MaterialIcons
                name="chat"
                color={activeScreen === "messages" ? theme.text : theme.textSecondary}
                size={NAV_ICON_SIZE}
              />
              {unreadMessageCount > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>
                    {unreadMessageCount > 99 ? "99+" : unreadMessageCount}
                  </Text>
                </View>
              )}
            </View>
            <Text style={[styles.navLabel, activeScreen === "messages" && styles.navLabelActive]}>Inbox</Text>
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
              color={activeScreen === "wallet" ? theme.text : theme.textSecondary}
              size={NAV_ICON_SIZE}
            />
            <Text style={[styles.navLabel, activeScreen === "wallet" && styles.navLabelActive]}>Wallet</Text>
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
                color={activeScreen === "bounty" ? theme.text : theme.textSecondary}
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
              color={activeScreen === "postings" ? theme.text : theme.textSecondary}
              size={NAV_ICON_SIZE}
            />
            <Text style={[styles.navLabel, activeScreen === "postings" && styles.navLabelActive]}>Activity</Text>
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
                color={activeScreen === "admin" ? "#00dc50" : theme.text}
                size={NAV_ICON_SIZE}
              />
              <Text style={[styles.navLabel, activeScreen === "admin" && styles.navLabelActive]}>Admin</Text>
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
                color={activeScreen === "profile" ? theme.target : theme.target}
                size={NAV_ICON_SIZE}
              />
              <Text style={[styles.navLabel, activeScreen === "profile" && styles.navLabelActive]}>Profile</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
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
      justifyContent: "center",
      height: 110,
      backgroundColor: theme.background,
      paddingHorizontal: 16,
      paddingBottom: 12,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      ...legacyTheme.shadows.lg,
      borderWidth: 1,
      borderColor: "rgba(0, 145, 44, 0.25)",
    },
    sideSection: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-evenly",
    },
    centerSection: {
      width: 80,
      alignItems: "center",
      justifyContent: "center",
    },
    navButton: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 16,
      backgroundColor: "transparent",
      minWidth: SIZING.MIN_TOUCH_TARGET,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: -28,
    },
    navLabel: {
      fontSize: 10,
      fontWeight: '600',
      marginTop: 3,
      color: theme.textSecondary,
    },
    navLabelActive: {
      color: theme.text,
    },
    iconWrapper: {
      position: 'relative',
    },
    badge: {
      position: 'absolute',
      top: -6,
      right: -8,
      backgroundColor: '#ef4444',
      borderRadius: 10,
      minWidth: 18,
      height: 18,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 3,
      borderWidth: 1.5,
      borderColor: theme.background,
    },
    badgeText: {
      color: '#ffffff',
      fontSize: 10,
      fontWeight: '700',
      lineHeight: 13,
    },
    centerButton: {
      height: 68,
      width: 68,
      backgroundColor: "rgba(0, 145, 44, 0.15)",
      borderWidth: 2.5,
      borderColor: "#00912C",
      borderRadius: 34,
      alignItems: "center",
      justifyContent: "center",
      marginTop: -28,
      minWidth: SIZING.MIN_TOUCH_TARGET + 24,
      minHeight: SIZING.MIN_TOUCH_TARGET + 24,
      ...legacyTheme.shadows.emerald,
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
}
