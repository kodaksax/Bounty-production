import { MaterialIcons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { getStoreUrl } from '../../lib/services/app-version-service';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';
import { useVersionGate } from '../../hooks/useVersionGate';
import { AppModal } from './app-modal';

/**
 * Prompts users onto a newer native build.
 *
 * Two states, driven by the published floor:
 *  - below `minimum` → a blocking, non-dismissable dialog
 *  - below `latest`  → a dismissible nudge, snoozed 24h once dismissed
 *
 * Complements the OTA path: expo-updates can only replace the JS bundle, so
 * anything requiring a new binary (native deps, config, entitlements) needs a
 * store update, and this is what asks for it.
 */
export function VersionGate() {
  const { theme } = useAppThemeContext();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const { isBlocked, showNudge, requirement, installedVersion, snooze } = useVersionGate();

  const visible = isBlocked || showNudge;
  if (!visible) return null;

  const openStore = () => {
    Linking.openURL(getStoreUrl(requirement)).catch(() => {
      // Nothing useful to fall back to — leave the prompt up so the user can retry.
    });
  };

  return (
    <AppModal
      visible={visible}
      // A required update must not be dismissable by backdrop tap or back button.
      dismissable={!isBlocked}
      onRequestClose={() => {
        if (!isBlocked) snooze();
      }}
      variant="dialog"
    >
      <View style={styles.card}>
        <View style={styles.iconCircle}>
          <MaterialIcons
            name={isBlocked ? 'system-update' : 'new-releases'}
            size={26}
            color={theme.primary}
          />
        </View>

        <Text style={styles.title}>
          {isBlocked ? 'Update required' : 'A new version is available'}
        </Text>

        <Text style={styles.body}>
          {requirement?.message ??
            (isBlocked
              ? 'This version of BOUNTY is no longer supported. Update to keep using the app.'
              : 'Update to get the latest features and fixes.')}
        </Text>

        {installedVersion && requirement ? (
          <Text style={styles.versions}>
            You have {installedVersion} · Latest is {requirement.latest}
          </Text>
        ) : null}

        <TouchableOpacity
          onPress={openStore}
          activeOpacity={0.85}
          style={styles.primaryButton}
          accessibilityRole="button"
          accessibilityLabel="Open the app store to update"
        >
          <Text style={styles.primaryLabel}>Update now</Text>
        </TouchableOpacity>

        {!isBlocked ? (
          <TouchableOpacity
            onPress={snooze}
            activeOpacity={0.7}
            style={styles.secondaryButton}
            accessibilityRole="button"
            accessibilityLabel="Remind me later"
          >
            <Text style={styles.secondaryLabel}>Later</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </AppModal>
  );
}

export default VersionGate;

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
    card: { paddingHorizontal: 24, paddingVertical: 28, alignItems: 'center' },
    iconCircle: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: theme.isDark ? 'rgba(5,150,105,0.22)' : 'rgba(5,150,105,0.12)',
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 18,
    },
    title: {
      fontSize: 20,
      fontWeight: '700',
      color: theme.text,
      textAlign: 'center',
    },
    body: {
      marginTop: 10,
      fontSize: 15,
      lineHeight: 21,
      color: theme.textSecondary,
      textAlign: 'center',
    },
    versions: {
      marginTop: 14,
      fontSize: 13,
      color: theme.textDisabled,
      textAlign: 'center',
    },
    primaryButton: {
      marginTop: 24,
      alignSelf: 'stretch',
      height: 52,
      borderRadius: 26,
      backgroundColor: theme.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    primaryLabel: { fontSize: 16, fontWeight: '700', color: '#ffffff' },
    secondaryButton: { marginTop: 12, paddingVertical: 10, paddingHorizontal: 16 },
    secondaryLabel: { fontSize: 15, fontWeight: '600', color: theme.textSecondary },
  });
}
