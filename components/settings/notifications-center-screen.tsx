import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAppThemeContext } from 'lib/themes/AppThemeContext';
import type { AppTheme } from 'lib/themes/types';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SettingsRow } from '../ui/settings-row';
import { SettingsScreenHeader } from '../ui/settings-screen-header';
import { SettingsSection } from '../ui/settings-section';
import { API_BASE_URL } from '../../lib/config/api';
import { supabase } from '../../lib/supabase';

interface NotificationsCenterScreenProps { onBack: () => void }

interface NotificationPrefs {
  newApplicants: boolean;
  acceptedRequests: boolean;
  reminders: boolean;
  system: boolean;
  chatMessages: boolean;
  follows: boolean;
  completions: boolean;
  payments: boolean;
  reminderLeadMinutes: string; // store as string for input control
}

const NOTIF_KEY = 'settings:notifications';

export const NotificationsCenterScreen: React.FC<NotificationsCenterScreenProps> = ({ onBack }) => {
  const { theme } = useAppThemeContext();
  const insets = useSafeAreaInsets();
  const s = useMemo(() => makeStyles(theme), [theme]);

  const [prefs, setPrefs] = useState<NotificationPrefs>({
    newApplicants: true,
    acceptedRequests: true,
    reminders: true,
    system: true,
    chatMessages: true,
    follows: true,
    completions: true,
    payments: true,
    reminderLeadMinutes: '30',
  });
  const [loaded, setLoaded] = useState(false);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    loadPreferences();
  }, []);

  const loadPreferences = async () => {
    try {
      // First, try to load from backend
      const { data: { session } } = await supabase.auth.getSession();

      if (session?.access_token) {
        try {
          const response = await fetch(
            `${API_BASE_URL}/notifications/preferences`,
            {
              method: 'GET',
              headers: {
                'Authorization': `Bearer ${session.access_token}`,
              },
            }
          );

          if (response.ok) {
            const data = await response.json();
            const backendPrefs = data.preferences;

            // Map backend preferences to frontend format
            setPrefs({
              newApplicants: backendPrefs.applications_enabled,
              acceptedRequests: backendPrefs.acceptances_enabled,
              reminders: backendPrefs.reminders_enabled,
              system: backendPrefs.system_enabled,
              chatMessages: backendPrefs.messages_enabled,
              follows: backendPrefs.follows_enabled,
              completions: backendPrefs.completions_enabled,
              payments: backendPrefs.payments_enabled,
              reminderLeadMinutes: '30', // This is still local only
            });

            // Also save to local storage as backup
            await AsyncStorage.setItem(NOTIF_KEY, JSON.stringify({
              newApplicants: backendPrefs.applications_enabled,
              acceptedRequests: backendPrefs.acceptances_enabled,
              reminders: backendPrefs.reminders_enabled,
              system: backendPrefs.system_enabled,
              chatMessages: backendPrefs.messages_enabled,
              follows: backendPrefs.follows_enabled,
              completions: backendPrefs.completions_enabled,
              payments: backendPrefs.payments_enabled,
            }));

            setLoaded(true);
            return;
          }
        } catch (apiError) {
          console.error('Failed to load preferences from API, falling back to local:', apiError);
        }
      }

      // Fallback to local storage
      const raw = await AsyncStorage.getItem(NOTIF_KEY);
      if (raw) {
        const localPrefs = JSON.parse(raw);
        setPrefs(prev => ({ ...prev, ...localPrefs }));
      }
    } catch (e) {
      console.error('Failed to load notification prefs', e);
    } finally {
      setLoaded(true);
    }
  };

  const persist = async (patch: Partial<NotificationPrefs>) => {
    setPrefs(prev => {
      const next = { ...prev, ...patch };

      // Save locally immediately for responsive UI
      AsyncStorage.setItem(NOTIF_KEY, JSON.stringify(next)).catch(err =>
        console.error('persist notif failed', err)
      );

      // Sync with backend
      syncToBackend(next);

      return next;
    });
  };

  const syncToBackend = async (preferences: NotificationPrefs) => {
    setSyncing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();

      if (!session?.access_token) {
        return;
      }

      // Map frontend preferences to backend format
      const backendPrefs = {
        applications_enabled: preferences.newApplicants,
        acceptances_enabled: preferences.acceptedRequests,
        reminders_enabled: preferences.reminders,
        system_enabled: preferences.system,
        messages_enabled: preferences.chatMessages,
        follows_enabled: preferences.follows,
        completions_enabled: preferences.completions,
        payments_enabled: preferences.payments,
      };

      const response = await fetch(
        `${API_BASE_URL}/notifications/preferences`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify(backendPrefs),
        }
      );

      if (!response.ok) {
        throw new Error('Failed to sync preferences with backend');
      }

    } catch (error) {
      console.error('Failed to sync preferences with backend:', error);
      // Continue silently, preferences are still saved locally
    } finally {
      setSyncing(false);
    }
  };

  const switchProps = (value: boolean, onChange: (v: boolean) => void, label: string) => ({
    value,
    onValueChange: onChange,
    trackColor: { false: theme.border, true: theme.primary },
    thumbColor: theme.surface,
    ios_backgroundColor: theme.border,
    accessibilityLabel: label,
  });

  return (
    <View style={s.screen}>
      <SettingsScreenHeader
        icon="notifications"
        title="Notification Center"
        onBack={onBack}
        rightNode={syncing ? <ActivityIndicator size="small" color={theme.primary} /> : undefined}
      />

      {!loaded ? (
        <View style={s.loadingContainer}>
          <ActivityIndicator size="large" color={theme.primary} />
          <Text style={s.loadingText}>Loading preferences...</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[s.scrollContent, { paddingBottom: Math.max(insets.bottom, 24) + 24 }]}
        >
          <SettingsSection description="Control which push notifications you receive. Settings are synced across all your devices.">
            <SettingsRow
              icon="person-add-alt"
              label="New Applicants"
              description="Alerts when a hunter applies to your bounty."
              right={<Switch {...switchProps(prefs.newApplicants, v => persist({ newApplicants: v }), 'New applicants notifications')} />}
            />
            <SettingsRow
              icon="check-circle"
              label="Accepted Requests"
              description="Updates when your request is accepted."
              right={<Switch {...switchProps(prefs.acceptedRequests, v => persist({ acceptedRequests: v }), 'Accepted requests notifications')} />}
            />
            <SettingsRow
              icon="task-alt"
              label="Bounty Completions"
              description="Notifications when bounties are completed."
              right={<Switch {...switchProps(prefs.completions, v => persist({ completions: v }), 'Bounty completion notifications')} />}
            />
            <SettingsRow
              icon="attach-money"
              label="Payments"
              description="Alerts when you receive payments."
              right={<Switch {...switchProps(prefs.payments, v => persist({ payments: v }), 'Payment notifications')} />}
            />
            <SettingsRow
              icon="chat"
              label="Chat Messages"
              description="Direct messages & bounty discussions."
              right={<Switch {...switchProps(prefs.chatMessages, v => persist({ chatMessages: v }), 'Chat message notifications')} />}
            />
            <SettingsRow
              icon="favorite"
              label="New Followers"
              description="Notifications when someone follows you."
              right={<Switch {...switchProps(prefs.follows, v => persist({ follows: v }), 'New follower notifications')} />}
            />
            <SettingsRow
              icon="schedule"
              label="Reminders"
              description="Due date & follow-up reminders."
              right={<Switch {...switchProps(prefs.reminders, v => persist({ reminders: v }), 'Reminder notifications')} />}
            />
            {prefs.reminders && (
              <View style={s.reminderRow}>
                <Text style={s.reminderLabel}>Minutes before due date</Text>
                <TextInput
                  keyboardType="numeric"
                  value={prefs.reminderLeadMinutes}
                  onChangeText={v => /^(\d{0,3})$/.test(v) && persist({ reminderLeadMinutes: v })}
                  placeholder="30"
                  placeholderTextColor={theme.textDisabled}
                  style={s.reminderInput}
                  accessibilityLabel="Minutes before due date"
                />
              </View>
            )}
            <SettingsRow
              icon="info"
              label="System"
              description="Platform updates & maintenance notices."
              right={<Switch {...switchProps(prefs.system, v => persist({ system: v }), 'System notifications')} />}
            />
          </SettingsSection>
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
    reminderRow: {
      paddingHorizontal: 12,
      paddingVertical: 12,
      paddingLeft: 56,
    },
    reminderLabel: {
      fontSize: 12,
      color: t.textSecondary,
      marginBottom: 8,
    },
    reminderInput: {
      backgroundColor: t.surfaceSecondary,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      color: t.text,
      fontSize: 15,
      width: 100,
    },
  });
}
