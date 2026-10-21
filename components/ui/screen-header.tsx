import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { press } from '../../lib/motion';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';

interface ScreenHeaderProps {
    title?: string;
    showBack?: boolean;
    onBack?: () => void;
    rightNode?: React.ReactNode;
    centerNode?: React.ReactNode;
    transparent?: boolean;
}

export function ScreenHeader({ title, showBack, onBack, rightNode, centerNode, transparent }: ScreenHeaderProps) {
    const router = useRouter();
    const { theme } = useAppThemeContext();
    const styles = useMemo(() => makeStyles(theme), [theme]);

    const handleBack = () => {
        if (onBack) {
            onBack();
        } else if (router.canGoBack()) {
            router.back();
        } else {
            router.replace('/');
        }
    };

    return (
        <View style={[styles.header, transparent && styles.transparent]}>
            <View style={styles.left}>
                {showBack && (
                    <TouchableOpacity
                        onPress={handleBack}
                        style={styles.iconButton}
                        activeOpacity={press.opacity}
                        // The visible button is 32pt; the slop brings the
                        // touch area to 44pt without moving the layout.
                        hitSlop={6}
                        accessibilityRole="button"
                        accessibilityLabel="Back"
                    >
                        <MaterialIcons name="arrow-back" size={24} color={theme.text} />
                    </TouchableOpacity>
                )}
            </View>
            <View style={styles.center}>
                {centerNode || (title ? <Text style={styles.title}>{title}</Text> : null)}
            </View>
            <View style={styles.right}>
                {rightNode}
            </View>
        </View>
    );
}

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 12,
        backgroundColor: theme.background,
    },
    transparent: {
        backgroundColor: 'transparent',
    },
    left: {
        flex: 1,
        alignItems: 'flex-start',
    },
    center: {
        flex: 2,
        alignItems: 'center',
    },
    right: {
        flex: 1,
        alignItems: 'flex-end',
    },
    title: {
        fontSize: 18,
        fontWeight: 'bold',
        color: theme.text,
    },
    iconButton: {
        padding: 4,
    }
  });
}
