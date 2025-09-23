import { MaterialIcons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, TouchableOpacity, View } from "react-native";

export type ScreenKey = "create" | "wallet" | "bounty" | "postings" | "profile";

interface BottomNavProps {
  activeScreen: string;
  onNavigate: (screen: ScreenKey) => void;
}

export function BottomNav({ activeScreen, onNavigate }: BottomNavProps) {
  return (
    <View style={styles.bottomNavContainer}>
      <View style={styles.bottomNav}>
        <TouchableOpacity onPress={() => onNavigate("create")} style={styles.navButton}>
          <MaterialIcons name="chat" color={activeScreen === "create" ? "#fff" : "#d1fae5"} size={24} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => onNavigate("wallet")} style={styles.navButton}>
          <MaterialIcons name="account-balance-wallet" color={activeScreen === "wallet" ? "#fff" : "#d1fae5"} size={24} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.centerButton} onPress={() => onNavigate("bounty")}>
          <MaterialIcons name="gps-fixed" color={activeScreen === "bounty" ? "#fff" : "#d1fae5"} size={28} />
        </TouchableOpacity>
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
    backgroundColor: "#065f46", // emerald-800
    paddingHorizontal: 28,
    paddingBottom: 8,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    elevation: 30,
  },
  navButton: {
    padding: 12,
  },
  centerButton: {
    height: 56,
    width: 56,
    backgroundColor: "transparent",
    borderWidth: 2,
    borderColor: "#fff",
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    marginTop: -20,
  },
});
