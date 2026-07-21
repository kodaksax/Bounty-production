'use client';

import { MaterialIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthProfile } from '../hooks/useAuthProfile';
import { useNormalizedProfile } from '../hooks/useNormalizedProfile';
import { useAdmin } from '../lib/admin-context';
import { useBountyFormat } from '../lib/bounty-format-context';
import { BOUNTY_FORMAT_OPTIONS } from '../lib/bounty-format-options';
import { analyticsService } from '../lib/services/analytics-service';
import { useAppThemeContext } from '../lib/themes/AppThemeContext';
import type { AppTheme, ThemeMode } from '../lib/themes/types';
import { markIntentionalSignOut } from '../lib/utils/session-handler';
import { SettingsRow } from './ui/settings-row';
import { SettingsScreenHeader } from './ui/settings-screen-header';
import { SettingsSection } from './ui/settings-section';
import { CommunityGuidelinesScreen } from './settings/community-guidelines-screen';
import { ContactSupportScreen } from './settings/contact-support-screen';
import { FAQScreen } from './settings/faq-screen';
import { FeedbackSupportScreen } from './settings/feedback-support-screen';
import { HelpSupportScreen } from './settings/help-support-screen';
import { LocationSettingsScreen } from './settings/location-settings-screen';
import { NotificationsCenterScreen } from './settings/notifications-center-screen';
import { PrivacySecurityScreen } from './settings/privacy-security-screen';
import { TermsPrivacyScreen } from './settings/terms-privacy-screen';

interface SettingsScreenProps {
  onBack?: () => void;
  navigation?: any;
}

type Panel =
  | 'root'
  | 'editProfile'
  | 'privacy'
  | 'notifications'
  | 'location'
  | 'help'
  | 'contact'
  | 'terms'
  | 'faq'
  | 'feedback'
  | 'guidelines';

const THEME_OPTIONS: [ThemeMode, keyof typeof MaterialIcons.glyphMap, string][] = [
  ['light', 'light-mode', 'Light'],
  ['dark', 'dark-mode', 'Dark'],
  ['system', 'settings-suggest', 'System'],
];

const FORMAT_OPTIONS: [BountyFormat, keyof typeof MaterialIcons.glyphMap, string][] = [
  ['card', 'view-agenda', 'Card'],
  ['compact', 'view-list', 'Compact'],
  ['grid', 'grid-view', 'Grid'],
];

export function SettingsScreen({ onBack }: SettingsScreenProps = {}) {
  const [panel, setPanel] = useState<Panel>('root');
  const { isAdmin, isAdminTabEnabled, setAdminTabEnabled } = useAdmin();
  const { theme, mode: themeMode, setTheme } = useAppThemeContext();
  const { bountyFormat, setBountyFormat } = useBountyFormat();
  const insets = useSafeAreaInsets();
  const s = useMemo(() => makeStyles(theme), [theme]);

  const { profile: authProfile } = useAuthProfile();
  useNormalizedProfile();

  const handleAdminTabToggle = async (value: boolean) => {
    await setAdminTabEnabled(value);
    Alert.alert(
      value ? 'Admin Tab Enabled' : 'Admin Tab Disabled',
      value
        ? 'The admin tab is now visible in the bottom navigation, replacing the profile tab.'
        : 'The admin tab has been hidden. Profile tab is now visible.',
      [{ text: 'OK' }]
    );
  };

  const handleEditProfile = () => router.push('/profile/edit');

  const handleLogOut = async () => {
    try {
      const { performLogout } = require('../lib/services/logout-service');
      await performLogout({
        currentUserId: authProfile?.id,
        router: require('expo-router').router,
      });
    } catch (e) {
      console.error('[Logout] Error:', e);
      Alert.alert('Error', 'Failed to log out properly.');
    }
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete Account',
      'Are you sure you want to delete your account? This will permanently delete:\n\n• Your profile and personal information\n• All your bounties (posted and accepted)\n• Your wallet transactions and balance\n• All messages and conversations\n• All notifications and settings\n\nThis action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const { supabase } = require('../lib/supabase');
            const SecureStore = require('expo-secure-store');
            const { authProfileService } = require('../lib/services/auth-profile-service');
            const { deleteUserAccount } = require('../lib/services/account-deletion-service');
            const currentUserId = authProfile?.id;
            if (!currentUserId) {
              Alert.alert('Error', 'Unable to identify user account. Please sign in again.');
              return;
            }
            Alert.alert(
              'Final Confirmation',
              'This will permanently delete your account. Are you absolutely sure?',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Yes, Delete',
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      markIntentionalSignOut();
                      const result = await deleteUserAccount();
                      if (!result.success) {
                        Alert.alert('Deletion Failed', result.message);
                        return;
                      }
                      try {
                        await authProfileService.clearUserDraftData(currentUserId);
                      } catch {}
                      try {
                        await SecureStore.deleteItemAsync('sb-access-token');
                        await SecureStore.deleteItemAsync('sb-refresh-token');
                      } catch {}
                      try {
                        await supabase.auth.signOut();
                      } catch {}
                      try {
                        const { router: r } = require('expo-router');
                        r?.replace?.('/auth/sign-in-form');
                      } catch {}
                      Alert.alert(
                        'Account Deleted',
                        result.message || 'Your account has been permanently deleted.'
                      );
                    } catch (e) {
                      Alert.alert('Error', 'Failed to delete account. Please try again or contact support.');
                    }
                  },
                },
              ]
            );
          },
        },
      ]
    );
  };

  // Panel routing
  if (panel === 'privacy') return <PrivacySecurityScreen onBack={() => setPanel('root')} />;
  if (panel === 'notifications')
    return <NotificationsCenterScreen onBack={() => setPanel('root')} />;
  if (panel === 'location') return <LocationSettingsScreen onBack={() => setPanel('root')} />;
  if (panel === 'help')
    return (
      <HelpSupportScreen
        onBack={() => setPanel('root')}
        onNavigateContact={() => setPanel('contact')}
        onNavigateTerms={() => setPanel('terms')}
        onNavigateFAQ={() => setPanel('faq')}
      />
    );
  if (panel === 'contact') return <ContactSupportScreen onBack={() => setPanel('help')} />;
  if (panel === 'terms') return <TermsPrivacyScreen onBack={() => setPanel('help')} />;
  if (panel === 'faq') return <FAQScreen onBack={() => setPanel('help')} />;
  if (panel === 'feedback') return <FeedbackSupportScreen onBack={() => setPanel('root')} />;
  if (panel === 'guidelines') return <CommunityGuidelinesScreen onBack={() => setPanel('root')} />;

  return (
    <View style={s.screen}>
      <SettingsScreenHeader icon="settings" title="Settings" onBack={onBack} />

      <ScrollView
        contentContainerStyle={[s.scrollContent, { paddingBottom: Math.max(insets.bottom, 24) + 24 }]}
      >
        <SettingsSection title="Account">
          <SettingsRow
            icon="person"
            label="Edit Profile"
            description="Update your photo, bio, and contact details."
            onPress={handleEditProfile}
          />
          <SettingsRow
            icon="lock"
            label="Privacy & Security"
            description="Password, two-factor authentication, and sessions."
            onPress={() => setPanel('privacy')}
          />
        </SettingsSection>

        <SettingsSection title="Notifications">
          <SettingsRow
            icon="notifications"
            label="Notification Center"
            description="New applicants, task updates, and payments."
            onPress={() => setPanel('notifications')}
          />
        </SettingsSection>

        <SettingsSection title="Preferences">
          <View style={s.pickerRow}>
            <View style={s.pickerLabelRow}>
              <MaterialIcons name="palette" size={20} color={theme.primaryLight} />
              <Text style={s.pickerLabel}>Appearance</Text>
            </View>
            <View style={s.segmentedControl}>
              {THEME_OPTIONS.map(([value, icon, label]) => {
                const active = themeMode === value;
                return (
                  <TouchableOpacity
                    key={value}
                    onPress={() => setTheme(value)}
                    style={[s.segment, active && s.segmentActive]}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: active }}
                    accessibilityLabel={`${label} mode`}
                  >
                    <MaterialIcons name={icon} size={16} color={active ? '#ffffff' : theme.textSecondary} />
                    <Text style={[s.segmentLabel, active && s.segmentLabelActive]}>{label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <View style={s.pickerRow}>
            <View style={s.pickerLabelRow}>
              <MaterialIcons name="view-list" size={20} color={theme.primaryLight} />
              <Text style={s.pickerLabel}>Bounty Display</Text>
            </View>
            <Text style={s.pickerDescription}>Choose how bounties appear in your feed.</Text>
            <View style={s.segmentedControl}>
              {FORMAT_OPTIONS.map(([value, icon, label]) => {
                const active = bountyFormat === value;
                return (
                  <TouchableOpacity
                    key={value}
                    onPress={() => setBountyFormat(value)}
                    style={[s.segment, active && s.segmentActive]}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: active }}
                    accessibilityLabel={`${label} format`}
                  >
                    <MaterialIcons name={icon} size={16} color={active ? '#ffffff' : theme.textSecondary} />
                    <Text style={[s.segmentLabel, active && s.segmentLabelActive]}>{label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </SettingsSection>

        <SettingsSection title="Location">
          <SettingsRow
            icon="place"
            label="Location & Visibility"
            description="Permissions, saved addresses, and location use."
            onPress={() => setPanel('location')}
          />
        </SettingsSection>

        <SettingsSection title="Support">
          <SettingsRow
            icon="help-center"
            label="Help & Support"
            description="FAQs, contact form, and legal documentation."
            onPress={() => setPanel('help')}
          />
          <SettingsRow
            icon="feedback"
            label="Feedback & Support"
            description="Report a bug, suggest a feature, or rate Bounty."
            onPress={() => setPanel('feedback')}
          />
          <SettingsRow
            icon="gavel"
            label="Terms & Privacy"
            description="Read our Terms of Service and Privacy Policy."
            onPress={() => setPanel('terms')}
          />
          <SettingsRow
            icon="security"
            label="Community Guidelines"
            description="Our standards for safety, trust, and respect."
            onPress={() => setPanel('guidelines')}
          />
        </SettingsSection>

        {isAdmin && (
          <SettingsSection title="Admin">
            <SettingsRow
              icon="admin-panel-settings"
              label="Admin Tab"
              description={
                isAdminTabEnabled
                  ? 'Visible in navigation, replacing the profile tab.'
                  : 'Enable to show the admin tab in navigation.'
              }
              right={
                <Switch
                  value={isAdminTabEnabled}
                  onValueChange={handleAdminTabToggle}
                  trackColor={{ false: theme.border, true: theme.primary }}
                  thumbColor={theme.surface}
                  ios_backgroundColor={theme.border}
                  accessibilityLabel="Toggle admin tab visibility"
                />
              }
            />
          </SettingsSection>
        )}

        <SettingsSection title="Session">
          <SettingsRow
            icon="logout"
            label="Log Out"
            description="Sign out of your account on this device."
            onPress={handleLogOut}
          />
        </SettingsSection>

        <SettingsSection
          title="Danger Zone"
          footer="Deleting your account permanently removes your profile, bounties, wallet history, and messages. This cannot be undone."
        >
          <SettingsRow
            icon="delete-forever"
            label="Delete Account"
            description="Permanently delete your account and all data."
            tone="destructive"
            onPress={handleDeleteAccount}
          />
        </SettingsSection>
      </ScrollView>
    </View>
  );
}

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
    pickerRow: {
      paddingHorizontal: 12,
      paddingVertical: 14,
    },
    pickerLabelRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 4,
    },
    pickerLabel: {
      fontSize: 15,
      fontWeight: '600',
      color: t.text,
    },
    pickerDescription: {
      fontSize: 13,
      color: t.textSecondary,
      marginBottom: 10,
    },
    segmentedControl: {
      flexDirection: 'row',
      gap: 8,
      marginTop: 8,
    },
    segment: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: 10,
      borderRadius: 10,
      backgroundColor: t.surfaceSecondary,
      borderWidth: 1,
      borderColor: t.border,
      minHeight: 44,
    },
    segmentActive: {
      backgroundColor: t.primary,
      borderColor: t.primary,
    },
    segmentLabel: {
      fontSize: 12,
      fontWeight: '600',
      color: t.textSecondary,
    },
    segmentLabelActive: {
      color: '#ffffff',
    },
  });
}
