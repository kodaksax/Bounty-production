import { MaterialIcons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

interface Skill {
  id: string;
  icon: string;
  text: string;
  credentialUrl?: string;
}

interface SkillsetChipsProps {
  skills: Skill[];
}

/**
 * Lightweight display-only chip list for skillsets
 * Used on Profile screen to show skills as horizontal chips
 */
export function SkillsetChips({ skills }: SkillsetChipsProps) {
  const alias: Record<string, string> = { heart: "favorite", target: "gps-fixed", globe: "public" };
  const getIconComponent = (iconName: string) => {
    const mappedName = alias[iconName] || iconName;
    return <MaterialIcons name={mappedName as any} size={16} color="#d1fae5" />;
  };

  if (!skills || skills.length === 0) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyText}>No skillsets added yet</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {skills.map((skill) => (
        <View key={skill.id} style={styles.chip}>
          <View style={styles.iconContainer}>{getIconComponent(skill.icon)}</View>
          <Text style={styles.chipText} numberOfLines={1}>
            {skill.text}
          </Text>
          {skill.credentialUrl && (
            <View style={styles.credentialBadge}>
              <MaterialIcons name="attach-file" size={12} color="#34d399" />
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(6, 78, 59, 0.4)",
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 12,
    gap: 6,
  },
  iconContainer: {
    width: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  chipText: {
    fontSize: 13,
    color: "#d1fae5",
    maxWidth: 150,
  },
  credentialBadge: {
    marginLeft: 2,
  },
  emptyState: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: "rgba(6, 78, 59, 0.2)",
    borderRadius: 8,
  },
  emptyText: {
    fontSize: 13,
    color: "#6ee7b7",
    fontStyle: "italic",
  },
});
