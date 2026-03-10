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

const ACHIEVEMENT_DEFINITIONS = [
  { name: "First Bounty", icon: "flag" as keyof typeof MaterialIcons.glyphMap },
  { name: "Task Complete", icon: "check-circle" as keyof typeof MaterialIcons.glyphMap },
  { name: "Trusted Member", icon: "verified-user" as keyof typeof MaterialIcons.glyphMap },
  { name: "Top Contributor", icon: "star" as keyof typeof MaterialIcons.glyphMap },
  { name: "Quick Responder", icon: "bolt" as keyof typeof MaterialIcons.glyphMap },
  { name: "Community Builder", icon: "groups" as keyof typeof MaterialIcons.glyphMap },
];

export function AchievementsGrid({ badgesEarned }: AchievementsGridProps) {
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
            // ↓ CHANGED: rgba(6,78,59,0.3) → #ffffff with light border
            backgroundColor: "#ffffff",
            borderRadius: 12,
            padding: 12,
            alignItems: "center",
            justifyContent: "center",
            opacity: achievement.isEarned ? 1 : 0.5,
            borderWidth: 1,
            // ↓ CHANGED: earned → #fbbf24 (amber, kept) | unearned → #e5e7eb (gray border)
            borderColor: achievement.isEarned ? "#fbbf24" : "#e5e7eb",
          }}
        >
          <View
            style={{
              height: 40,
              width: 40,
              borderRadius: 20,
              // ↓ CHANGED: earned → #059669 (kept) | unearned → #F8F9FA
              backgroundColor: achievement.isEarned ? "#059669" : "#F8F9FA",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 8,
            }}
          >
            <MaterialIcons
              name={achievement.icon}
              size={20}
              // ↓ CHANGED: unearned icon color #6b7280 → #9ca3af (lighter gray, matches theme)
              color={achievement.isEarned ? "#ffffff" : "#9ca3af"}
            />
          </View>
          <Text
            style={{
              fontSize: 12,
              // ↓ CHANGED: #d1fae5 → #1a1a1a (dark text on white card)
              color: "#1a1a1a",
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