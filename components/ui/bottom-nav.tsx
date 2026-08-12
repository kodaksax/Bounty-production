import { MaterialIcons } from "@expo/vector-icons";
import { useHapticFeedback } from "lib/haptic-feedback";
import React, { useEffect, useRef, useMemo } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from "react-native";
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

// The center button scales up to this factor while the bounty tab is active.
// The center column must reserve room for the *scaled* width, otherwise the
// grown crosshair spills sideways over the Wallet/Post buttons.
const CENTER_ACTIVE_SCALE = 1.15;
// Horizontal breathing room between the center column and the side sections.
const CENTER_GUTTER = 8;
// Caps how far OS Dynamic Type can inflate the tab labels. Unbounded scaling at
// the largest accessibility sizes is the other way these buttons collide.
const NAV_LABEL_MAX_FONT_SCALE = 1.2;

/**
 * Derives the center button size from the viewport width instead of hardcoding
 * it, so the crosshair keeps the same visual weight from a 320pt SE up to a
 * 430pt Pro Max. Clamped at both ends: below ~56 the icon crowds its border,
 * above ~72 it dominates the bar.
 */
function getCenterMetrics(windowWidth: number) {
  const buttonSize = Math.round(Math.min(72, Math.max(56, windowWidth * 0.17)));
  // Reserve the scaled footprint plus a gutter so the side sections can never
  // be laid out underneath the active (enlarged) button.
  const sectionWidth = Math.ceil(buttonSize * CENTER_ACTIVE_SCALE) + CENTER_GUTTER;
  return { buttonSize, sectionWidth };
}

export function BottomNav({ activeScreen, onNavigate, showAdmin = false, onBountyTabRepress, unreadMessageCount = 0 }: BottomNavProps) {
  const centerButtonScale = useRef(new Animated.Value(1)).current;
  const centerButtonRotation = useRef(new Animated.Value(0)).current;
  const { triggerHaptic } = useHapticFeedback();
  const { theme } = useAppThemeContext();
  const { width: windowWidth } = useWindowDimensions();
  const { buttonSize: centerButtonSize, sectionWidth: centerSectionWidth } = useMemo(
    () => getCenterMetrics(windowWidth),
    [windowWidth]
  );
  const styles = useMemo(
    () => makeStyles(theme, centerButtonSize, centerSectionWidth),
    [theme, centerButtonSize, centerSectionWidth]
  );

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
            accessibilityLabel={unreadMessageCount > 0 ? `My Bounties, ${unreadMessageCount} unread` : "View your bounties"}
            accessibilityState={{ selected: activeScreen === "messages" }}
          >
            <View style={styles.iconWrapper}>
              <MaterialIcons
                name="assignment"
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
            <Text
              numberOfLines={1}
              maxFontSizeMultiplier={NAV_LABEL_MAX_FONT_SCALE}
              style={[styles.navLabel, activeScreen === "messages" && styles.navLabelActive]}
            >
              My Bounties
            </Text>
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
            <Text
              numberOfLines={1}
              maxFontSizeMultiplier={NAV_LABEL_MAX_FONT_SCALE}
              style={[styles.navLabel, activeScreen === "wallet" && styles.navLabelActive]}
            >
              Wallet
            </Text>
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
            accessibilityLabel="Post a new bounty"
            accessibilityState={{ selected: activeScreen === "postings" }}
          >
            <MaterialIcons
              name="post-add"
              color={activeScreen === "postings" ? theme.text : theme.textSecondary}
              size={NAV_ICON_SIZE}
            />
            <Text
              numberOfLines={1}
              maxFontSizeMultiplier={NAV_LABEL_MAX_FONT_SCALE}
              style={[styles.navLabel, activeScreen === "postings" && styles.navLabelActive]}
            >
              Post
            </Text>
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
              <Text
                numberOfLines={1}
                maxFontSizeMultiplier={NAV_LABEL_MAX_FONT_SCALE}
                style={[styles.navLabel, activeScreen === "admin" && styles.navLabelActive]}
              >
                Admin
              </Text>
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
                color={activeScreen === "profile" ? theme.text : theme.textSecondary}
                size={NAV_ICON_SIZE}
              />
              <Text
                numberOfLines={1}
                maxFontSizeMultiplier={NAV_LABEL_MAX_FONT_SCALE}
                style={[styles.navLabel, activeScreen === "profile" && styles.navLabelActive]}
              >
                Profile
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}

function makeStyles(theme: AppTheme, centerButtonSize: number, centerSectionWidth: number) {
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
      borderColor: "rgba(5, 150, 105, 0.25)",
    },
    sideSection: {
      flex: 1,
      // Without minWidth:0 a flex row refuses to size below its content, which
      // is what let the side sections bleed into the center column.
      minWidth: 0,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-evenly",
    },
    centerSection: {
      width: centerSectionWidth,
      // Fixed column: never grow, never shrink, so the crosshair keeps its
      // exact center position no matter how wide the labels are.
      flexGrow: 0,
      flexShrink: 0,
      alignItems: "center",
      justifyContent: "center",
    },
    navButton: {
      // flex:1 + minWidth:0 makes each button take an equal share of its side
      // section and, critically, allows it to SHRINK. React Native defaults
      // flexShrink to 0, so the old fixed-padding buttons overflowed their
      // section and rendered over the center crosshair on narrow screens.
      flex: 1,
      minWidth: 0,
      paddingHorizontal: 4,
      paddingVertical: 6,
      borderRadius: 16,
      backgroundColor: "transparent",
      // Height (not width) now carries the 44pt touch-target guarantee; width
      // is whatever equal share the viewport allows, always >= 44 down to 320pt.
      minHeight: SIZING.MIN_TOUCH_TARGET,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: -28,
    },
    navLabel: {
      fontSize: 10,
      fontWeight: '600',
      marginTop: 3,
      color: theme.textSecondary,
      textAlign: 'center',
      // Belt-and-braces: even if a label were wider than its share, it wraps to
      // ellipsis inside the button rather than pushing the layout sideways.
      width: '100%',
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
      height: centerButtonSize,
      width: centerButtonSize,
      backgroundColor: "rgba(5, 150, 105, 0.15)",
      borderWidth: 2.5,
      borderColor: "#059669",
      borderRadius: centerButtonSize / 2,
      alignItems: "center",
      justifyContent: "center",
      marginTop: -28,
      ...legacyTheme.shadows.emerald,
      overflow: 'hidden',
    },
    centerButtonInner: {
      width: "100%",
      height: "100%",
      alignItems: "center",
      justifyContent: "center",
      borderRadius: centerButtonSize / 2,
    },
  });
}
