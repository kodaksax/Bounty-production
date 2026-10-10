import { MaterialIcons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { useHapticFeedback } from "lib/haptic-feedback";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, LayoutChangeEvent, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppThemeContext } from "../../lib/themes/AppThemeContext";
import type { AppTheme } from "../../lib/themes/types";
import type { ScreenKey } from "./bottom-nav";

/**
 * Floating pill tab bar — the compact, detached bar most iOS apps now use.
 * Same tabs and behaviour as the classic BottomNav (components/ui/bottom-nav.tsx,
 * kept for later); icon + label per tab, with a highlight capsule that
 * slides to the active tab.
 *
 * Its top edge sits below the classic bar's visible height, so screens that
 * clear BottomNav via getBottomNavContentPadding() clear this too.
 */

interface FloatingTabBarProps {
  activeScreen: string;
  onNavigate: (screen: ScreenKey) => void;
  showAdmin?: boolean;
  onBountyTabRepress?: () => void;
  unreadMessageCount?: number;
}

const BAR_HEIGHT = 64;
const BAR_SIDE_MARGIN = 16;
const BAR_PADDING = 5;
const ICON_SIZE = 23;
const CENTER_ICON_SIZE = 25;
// Caps Dynamic Type so labels can't push the bar taller than BAR_HEIGHT.
const LABEL_MAX_FONT_SCALE = 1.2;

type Tab = { key: ScreenKey; icon: keyof typeof MaterialIcons.glyphMap; title: string; label: string };

export function FloatingTabBar({
  activeScreen,
  onNavigate,
  showAdmin = false,
  onBountyTabRepress,
  unreadMessageCount = 0,
}: FloatingTabBarProps) {
  const { theme } = useAppThemeContext();
  const { triggerHaptic } = useHapticFeedback();
  const insets = useSafeAreaInsets();
  const s = useMemo(() => makeStyles(theme), [theme]);

  const tabs: Tab[] = useMemo(
    () => [
      {
        key: "messages",
        icon: "assignment",
        title: "Inbox",
        label:
          unreadMessageCount > 0
            ? `My Bounties, ${unreadMessageCount} unread message${unreadMessageCount === 1 ? "" : "s"}`
            : "View your bounties",
      },
      { key: "wallet", icon: "account-balance-wallet", title: "Wallet", label: "View wallet and transactions" },
      { key: "bounty", icon: "gps-fixed", title: "Home", label: "View bounty dashboard - Main screen" },
      { key: "postings", icon: "post-add", title: "Post", label: "Post a new bounty" },
      showAdmin
        ? { key: "admin", icon: "admin-panel-settings", title: "Admin", label: "Admin panel" }
        : { key: "profile", icon: "person", title: "Profile", label: "View and edit profile" },
    ],
    [showAdmin, unreadMessageCount]
  );

  // Sliding highlight behind the active tab.
  const [tabWidth, setTabWidth] = useState(0);
  const activeIndex = Math.max(0, tabs.findIndex(t => t.key === activeScreen));
  const highlightX = useRef(new Animated.Value(0)).current;
  const onRowLayout = useCallback(
    (e: LayoutChangeEvent) => setTabWidth(e.nativeEvent.layout.width / tabs.length),
    [tabs.length]
  );
  useEffect(() => {
    Animated.spring(highlightX, {
      toValue: activeIndex * tabWidth,
      useNativeDriver: true,
      speed: 18,
      bounciness: 6,
    }).start();
  }, [activeIndex, tabWidth, highlightX]);

  const handlePress = useCallback(
    (screen: ScreenKey) => {
      if (screen === "bounty" && activeScreen === "bounty") {
        triggerHaptic("light");
        onBountyTabRepress?.();
        return;
      }
      if (screen === activeScreen) return;
      triggerHaptic(screen === "bounty" ? "medium" : "selection");
      onNavigate(screen);
    },
    [activeScreen, onNavigate, onBountyTabRepress, triggerHaptic]
  );

  const isKnownTab = tabs.some(t => t.key === activeScreen);

  return (
    <View
      pointerEvents="box-none"
      style={[s.container, { bottom: Math.max(insets.bottom - 8, 12) }]}
    >
      <View style={s.bar}>
        <BlurView intensity={50} tint={theme.isDark ? "dark" : "light"} style={StyleSheet.absoluteFill} />
        <View style={s.row} onLayout={onRowLayout}>
          {tabWidth > 0 && isKnownTab && (
            <Animated.View
              pointerEvents="none"
              style={[s.highlight, { width: tabWidth, transform: [{ translateX: highlightX }] }]}
            />
          )}
          {tabs.map(tab => {
            const active = tab.key === activeScreen;
            const isCenter = tab.key === "bounty";
            return (
              <TouchableOpacity
                key={tab.key}
                onPress={() => handlePress(tab.key)}
                style={s.tab}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={tab.label}
                accessibilityState={{ selected: active }}
              >
                <View>
                  <MaterialIcons
                    name={tab.icon}
                    size={isCenter ? CENTER_ICON_SIZE : ICON_SIZE}
                    // The bullseye is always brand green; others brighten when active.
                    color={isCenter ? theme.primary : active ? theme.text : theme.textSecondary}
                  />
                  {tab.key === "messages" && unreadMessageCount > 0 && (
                    <View style={s.badge}>
                      <Text style={s.badgeText} maxFontSizeMultiplier={1.2}>
                        {unreadMessageCount > 99 ? "99+" : unreadMessageCount}
                      </Text>
                    </View>
                  )}
                </View>
                <Text
                  style={[s.label, active && s.labelActive, isCenter && { color: theme.primary }]}
                  numberOfLines={1}
                  maxFontSizeMultiplier={LABEL_MAX_FONT_SCALE}
                >
                  {tab.title}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    </View>
  );
}

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    container: {
      position: "absolute",
      left: BAR_SIDE_MARGIN,
      right: BAR_SIDE_MARGIN,
      zIndex: 100,
    },
    bar: {
      height: BAR_HEIGHT,
      borderRadius: BAR_HEIGHT / 2,
      overflow: "hidden",
      padding: BAR_PADDING,
      backgroundColor: t.isDark ? "rgba(27,30,36,0.82)" : "rgba(255,255,255,0.72)",
      borderWidth: StyleSheet.hairlineWidth * 2,
      borderColor: t.isDark ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.9)",
      shadowColor: "#000",
      shadowOpacity: t.isDark ? 0.45 : 0.16,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 },
      elevation: 10,
    },
    row: {
      flex: 1,
      flexDirection: "row",
    },
    highlight: {
      position: "absolute",
      top: 0,
      bottom: 0,
      left: 0,
      borderRadius: (BAR_HEIGHT - BAR_PADDING * 2) / 2,
      backgroundColor: t.isDark ? "rgba(230,222,209,0.14)" : "rgba(49,54,63,0.08)",
    },
    tab: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: 2,
    },
    label: {
      fontSize: 10,
      fontWeight: "600",
      color: t.textSecondary,
    },
    labelActive: {
      color: t.text,
    },
    badge: {
      position: "absolute",
      top: -4,
      right: -8,
      minWidth: 16,
      height: 16,
      paddingHorizontal: 4,
      borderRadius: 8,
      backgroundColor: t.error,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1.5,
      borderColor: t.isDark ? "#1B1E24" : "#FFFFFF",
    },
    badgeText: {
      color: "#FFFFFF",
      fontSize: 10,
      fontWeight: "700",
    },
  });
}
