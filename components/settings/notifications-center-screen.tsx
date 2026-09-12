import { useAppThemeContext } from 'lib/themes/AppThemeContext';
import type { AppTheme } from 'lib/themes/types';
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_LABELS,
  isForcedChannel,
} from 'lib/config/notification-taxonomy';
import type { NotificationCategory } from 'lib/types';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SettingsRow } from '../ui/settings-row';
import { SettingsScreenHeader } from '../ui/settings-screen-header';
import { SettingsSection } from '../ui/settings-section';
import { notificationService } from '../../lib/services/notification-service';
import { capture as posthogCapture } from '../../lib/posthog';

interface NotificationsCenterScreenProps { onBack: () => void }

const CATEGORY_ICON: Record<NotificationCategory, keyof typeof MaterialIcons.glyphMap> = {
  marketplace: 'storefront',
  messages: 'chat',
  payments: 'attach-money',
  security: 'shield',
  verification: 'verified-user',
  followers: 'favorite',
  marketing: 'campaign',
};

const CATEGORY_DESCRIPTION: Record<NotificationCategory, string> = {
  marketplace: 'Applications, acceptances, completions, and bounty updates.',
  messages: 'Direct messages and bounty discussions.',
  payments: 'Payouts, withdrawals, and payout method changes.',
  security: 'Disputes and account-integrity alerts. Push & in-app can’t be turned off.',
  verification: 'Identity verification status updates. Push & in-app can’t be turned off.',
  followers: 'When someone follows you.',
  marketing: 'Product news, tips, and promotions.',
};

type Channel = 'push' | 'email' | 'in_app';
const CHANNELS: { key: Channel; label: string; icon: keyof typeof MaterialIcons.glyphMap }[] = [
  { key: 'push', label: 'Push', icon: 'notifications' },
  { key: 'email', label: 'Email', icon: 'email' },
  { key: 'in_app', label: 'In-app', icon: 'notifications-none' },
];

export const NotificationsCenterScreen: React.FC<NotificationsCenterScreenProps> = ({ onBack }) => {
  const { theme } = useAppThemeContext();
  const insets = useSafeAreaInsets();
  const s = useMemo(() => makeStyles(theme), [theme]);

  // Keyed `${category}:${channel}` -> enabled. Missing key = enabled (fail-open,
  // matching the server's row-absent-means-allow default).
  const [prefs, setPrefs] = useState<Record<string, boolean>>({});
  const [loaded, setLoaded] = useState(false);
  const [syncingKey, setSyncingKey] = useState<string | null>(null);

  useEffect(() => {
    notificationService.getChannelPreferences()
      .then(setPrefs)
      .finally(() => setLoaded(true));
  }, []);

  const isEnabled = (category: NotificationCategory, channel: Channel) => {
    if (isForcedChannel(category, channel)) return true;
    const key = `${category}:${channel}`;
    return prefs[key] !== undefined ? prefs[key] : true;
  };

  const toggle = async (category: NotificationCategory, channel: Channel, value: boolean) => {
    const key = `${category}:${channel}`;
    setPrefs(prev => ({ ...prev, [key]: value }));
    setSyncingKey(key);
    posthogCapture('notification_preference_toggled', { category, channel, enabled: value });
    try {
      await notificationService.setChannelPreference(category, channel, value);
    } catch (e) {
      // Revert on failure
      setPrefs(prev => ({ ...prev, [key]: !value }));
    } finally {
      setSyncingKey(null);
    }
  };

  const switchProps = (value: boolean, onChange: (v: boolean) => void, label: string, disabled = false) => ({
    value,
    onValueChange: onChange,
    disabled,
    trackColor: { false: theme.border, true: theme.primary },
    thumbColor: theme.surface,
    ios_backgroundColor: theme.border,
    accessibilityLabel: label,
  });

  return (
    <View style={s.screen}>
      <SettingsScreenHeader icon="notifications" title="Notification Preferences" onBack={onBack} />

      {!loaded ? (
        <View style={s.loadingContainer}>
          <ActivityIndicator size="large" color={theme.primary} />
          <Text style={s.loadingText}>Loading preferences...</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[s.scrollContent, { paddingBottom: Math.max(insets.bottom, 24) + 24 }]}
        >
          {NOTIFICATION_CATEGORIES.map((category) => (
            <SettingsSection
              key={category}
              title={NOTIFICATION_CATEGORY_LABELS[category]}
              description={CATEGORY_DESCRIPTION[category]}
            >
              {CHANNELS.map(({ key: channel, label, icon }) => {
                const forced = isForcedChannel(category, channel);
                const prefKey = `${category}:${channel}`;
                return (
                  <SettingsRow
                    key={channel}
                    icon={icon}
                    label={label}
                    right={
                      syncingKey === prefKey ? (
                        <ActivityIndicator size="small" color={theme.primary} />
                      ) : (
                        <Switch
                          {...switchProps(
                            isEnabled(category, channel),
                            (v) => toggle(category, channel, v),
                            `${NOTIFICATION_CATEGORY_LABELS[category]} ${label} notifications`,
                            forced
                          )}
                        />
                      )
                    }
                  />
                );
              })}
              <SettingsRow
                icon="sms"
                label="SMS"
                description="Coming soon"
                disabled
                right={<Switch {...switchProps(false, () => {}, 'SMS notifications (coming soon)', true)} />}
              />
            </SettingsSection>
          ))}
        </ScrollView>
      )}
    </View>
  );
};

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: t.background,
    },
    scrollContent: {
      paddingHorizontal: 16,
      paddingTop: 20,
    },
    loadingContainer: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    loadingText: {
      color: t.textSecondary,
      marginTop: 12,
      fontSize: 14,
    },
  });
}
