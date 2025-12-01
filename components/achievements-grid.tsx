import { MaterialIcons } from "@expo/vector-icons";
import React from "react";
import { Text, View } from "react-native";

interface Achievement {
  id: string;
  name: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  isEarned: boolean;
}

interface AchievementsGridProps {
  badgesEarned: number;
}

// Define real achievement milestones that users can earn
const ACHIEVEMENT_DEFINITIONS = [
  { name: "First Bounty", icon: "flag" as keyof typeof MaterialIcons.glyphMap },
  { name: "Task Complete", icon: "check-circle" as keyof typeof MaterialIcons.glyphMap },
  { name: "Trusted Member", icon: "verified-user" as keyof typeof MaterialIcons.glyphMap },
  { name: "Top Contributor", icon: "star" as keyof typeof MaterialIcons.glyphMap },
  { name: "Quick Responder", icon: "bolt" as keyof typeof MaterialIcons.glyphMap },
  { name: "Community Builder", icon: "groups" as keyof typeof MaterialIcons.glyphMap },
];

/**
 * Responsive grid display for user achievements/badges
 * Shows a 3-column grid with badge status (earned vs locked)
 */
export function AchievementsGrid({ badgesEarned }: AchievementsGridProps) {
  // Build achievements based on definitions and earned count
  const achievements: Achievement[] = ACHIEVEMENT_DEFINITIONS.map((def, i) => ({
    id: `achievement-${i}`,
    name: def.name,
    icon: def.icon,
    isEarned: i < badgesEarned,
  }));

  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
      {achievements.map((achievement) => (
        <View
          key={achievement.id}
          style={{
            flex: 1,
            minWidth: "30%",
            maxWidth: "32%",
            aspectRatio: 1,
            backgroundColor: "rgba(6, 78, 59, 0.3)",
            borderRadius: 12,
            padding: 12,
            alignItems: "center",
            justifyContent: "center",
            opacity: achievement.isEarned ? 1 : 0.5,
            borderWidth: achievement.isEarned ? 1 : 0,
            borderColor: achievement.isEarned ? "#fbbf24" : "transparent",
          }}
        >
          <View
            style={{
              height: 40,
              width: 40,
              borderRadius: 20,
              backgroundColor: achievement.isEarned ? "#059669" : "#064e3b",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 8,
            }}
          >
            <MaterialIcons
              name={achievement.icon}
              size={20}
              color={achievement.isEarned ? "#ffffff" : "#6b7280"}
            />
          </View>
          <Text
            style={{
              fontSize: 12,
              color: "#d1fae5",
              textAlign: "center",
            }}
            numberOfLines={2}
          >
            {achievement.name}
          </Text>
        </View>
      ))}
    </View>
  );
}
