import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { colors } from '../../lib/theme';
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
                    <TouchableOpacity onPress={handleBack} style={styles.iconButton} accessibilityRole="button" accessibilityLabel="Back">
                        <MaterialIcons name="arrow-back" size={24} color="#ffffff" />
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

const styles = StyleSheet.create({
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 12,
        backgroundColor: colors.background.secondary, // emerald-600
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
        color: '#ffffff',
    },
    iconButton: {
        padding: 4,
    }
});
