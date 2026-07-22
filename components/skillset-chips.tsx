import { MaterialIcons } from "@expo/vector-icons";
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from "react-native";
import { useAppThemeContext } from '../lib/themes/AppThemeContext';
import type { AppTheme } from '../lib/themes/types';

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
  const { theme } = useAppThemeContext();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const alias: Record<string, string> = { heart: "favorite", target: "gps-fixed", globe: "public" };
  const getIconComponent = (iconName: string) => {
    const mappedName = alias[iconName] || iconName;
    return <MaterialIcons name={mappedName as any} size={16} color={theme.text} />;
  };

  if (!skills || skills.length === 0) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyText}>No skills added yet. Tap "Edit Profile" to add your expertise.</Text>
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
              <MaterialIcons name="attach-file" size={12} color="#059669" />
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
    container: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
    },
    chip: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: theme.surfaceSecondary,
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
      color: theme.text,
      maxWidth: 150,
    },
    credentialBadge: {
      marginLeft: 2,
    },
    emptyState: {
      paddingVertical: 12,
      paddingHorizontal: 16,
      backgroundColor: theme.surfaceSecondary,
      borderRadius: 8,
    },
    emptyText: {
      fontSize: 13,
      color: theme.primaryLight,
      fontStyle: "italic",
    },
  });
}
