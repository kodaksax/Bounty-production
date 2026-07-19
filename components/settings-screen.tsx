'use client';

import { MaterialIcons } from '@expo/vector-icons';
import { BrandingLogo } from 'components/ui/branding-logo';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { useAuthProfile } from '../hooks/useAuthProfile';
import { useNormalizedProfile } from '../hooks/useNormalizedProfile';
import { useAdmin } from '../lib/admin-context';
import { useBountyFormat } from '../lib/bounty-format-context';
import { BOUNTY_FORMAT_OPTIONS } from '../lib/bounty-format-options';
import { analyticsService } from '../lib/services/analytics-service';
import { useAppThemeContext } from '../lib/themes/AppThemeContext';
import type { AppTheme, ThemeMode } from '../lib/themes/types';
import { markIntentionalSignOut } from '../lib/utils/session-handler';
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
  | 'feedback';

export function SettingsScreen({ onBack }: SettingsScreenProps = {}) {
  const [panel, setPanel] = useState<Panel>('root');
  const { isAdmin, isAdminTabEnabled, setAdminTabEnabled } = useAdmin();
  const { theme, mode: themeMode, setTheme } = useAppThemeContext();
  const { bountyFormat, setBountyFormat } = useBountyFormat();
  const s = makeStyles(theme);

  const { profile: authProfile } = useAuthProfile();
  const { profile: normalizedProfile } = useNormalizedProfile();

  const profileData = {
    name: authProfile?.username || normalizedProfile?.username || '@user',
    about: authProfile?.about || normalizedProfile?.bio || '',
    phone: '+998 90 943 32 00',
    avatar:
      authProfile?.avatar || normalizedProfile?.avatar || '/placeholder.svg?height=48&width=48',
  };

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

  return (
    <View style={s.screen} className="flex-1">
      {/* Header */}
      <View className="flex-row justify-between items-center p-4">
        <BrandingLogo size="medium" />
        <TouchableOpacity onPress={onBack} accessibilityRole="button" accessibilityLabel="Back">
          <MaterialIcons name="arrow-back" size={24} color={theme.text} />
        </TouchableOpacity>
      </View>

      <ScrollView className="px-4" contentContainerStyle={{ paddingBottom: 96 }}>
        <Text style={s.pageTitle} className="text-xl font-semibold mb-4 text-center">
          Settings
        </Text>

        {/* ── Settings cards ───────────────────────────────────────────────── */}
        <SettingsCard
          theme={theme}
          title="Edit Profile"
          description="Modify your personal information, profile picture, contact details, and role preferences."
          primaryLabel="Save Changes"
          secondaryLabel="View My Profile"
          onPrimary={handleEditProfile}
          onSecondary={handleEditProfile}
          icon="person"
        />

        <SettingsCard
          theme={theme}
          title="Privacy & Security Settings"
          description="Manage your account's privacy and security, including password changes and two-factor authentication."
          primaryLabel="Open"
          onPrimary={() => setPanel('privacy')}
          icon="lock"
        />

        <SettingsCard
          theme={theme}
          title="Notifications Center"
          description="Aggregates all in-app notifications such as new applicants, task assignments, and payment updates."
          primaryLabel="Open"
          onPrimary={() => setPanel('notifications')}
          icon="notifications"
        />

        {/* ── Appearance ──────────────────────────────────────────────────── */}
        <View style={s.card} className="rounded-xl p-4 mb-4">
          <View className="flex-row items-center mb-3">
            <MaterialIcons name="palette" size={22} color={theme.primaryLight} />
            <Text style={s.cardTitle} className="ml-2 font-medium text-sm">
              Dark / Light mode
            </Text>
          </View>
          <View className="flex-row gap-2">
            {(
              [
                ['light', '☀️', 'Light'],
                ['dark', '🌙', 'Dark'],
                ['system', '⚙️', 'System'],
              ] as [ThemeMode, string, string][]
            ).map(([value, icon, label]) => {
              const active = themeMode === value;
              return (
                <TouchableOpacity
                  key={value}
                  onPress={() => setTheme(value)}
                  style={active ? s.themeChipActive : s.themeChipInactive}
                  className="flex-1 py-2 rounded-lg items-center border"
                  accessibilityRole="radio"
                  accessibilityState={{ checked: active }}
                  accessibilityLabel={`${label} mode`}
                >
                  <Text className="text-base">{icon}</Text>
                  <Text
                    style={active ? s.themeChipLabelActive : s.themeChipLabelInactive}
                    className="text-xs font-medium mt-0.5"
                  >
                    {label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
        {/* ── Bounty Display Format ────────────────────────────────────────── */}
        <View style={s.card} className="rounded-xl p-4 mb-4">
          <View className="flex-row items-center mb-3">
            <MaterialIcons name="view-list" size={22} color={theme.primaryLight} />
            <Text style={s.cardTitle} className="ml-2 font-medium text-sm">
              Bounty Display
            </Text>
          </View>
          <Text style={s.cardDescription} className="text-xs leading-4 mb-3">
            Choose how bounties appear in your feed.
          </Text>
          <View className="flex-row gap-2">
            {BOUNTY_FORMAT_OPTIONS.map(({ value, icon, label }) => {
              const active = bountyFormat === value;
              return (
                <TouchableOpacity
                  key={value}
                  onPress={() => {
                    setBountyFormat(value);
                    analyticsService.trackEvent('settings_bounty_format_changed', { format: value });
                  }}
                  style={active ? s.themeChipActive : s.themeChipInactive}
                  className="flex-1 py-2 rounded-lg items-center border"
                  accessibilityRole="radio"
                  accessibilityState={{ checked: active }}
                  accessibilityLabel={`${label} format`}
                >
                  <Text className="text-base">{icon}</Text>
                  <Text
                    style={active ? s.themeChipLabelActive : s.themeChipLabelInactive}
                    className="text-xs font-medium mt-0.5"
                  >
                    {label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <SettingsCard
          theme={theme}
          title="Location & Visibility"
          description="Manage location permissions, saved addresses, and control how location data is used."
          primaryLabel="Open"
          onPrimary={() => setPanel('location')}
          icon="place"
        />

        <SettingsCard
          theme={theme}
          title="Help & Support"
          description="FAQs, a direct contact form, and links to legal documentation."
          primaryLabel="Open"
          onPrimary={() => setPanel('help')}
          icon="help-center"
        />

        <SettingsCard
          theme={theme}
          title="Feedback & Support"
          description="Report a bug, suggest a feature, contact our support team, or rate Bounty on the app store."
          primaryLabel="Open"
          onPrimary={() => setPanel('feedback')}
          icon="feedback"
        />

        {/* Admin Tab Toggle - only visible to users with admin permissions */}
        {isAdmin && (
          <View style={s.card} className="rounded-xl p-4 mb-4">
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center flex-1">
                <MaterialIcons name="admin-panel-settings" size={22} color={theme.primaryLight} />
                <View className="ml-2 flex-1">
                  <Text style={s.cardTitle} className="font-medium text-sm">
                    Admin Tab
                  </Text>
                  <Text
                    style={s.cardDescription}
                    className="text-xs leading-4 mt-1"
                    numberOfLines={2}
                  >
                    {isAdminTabEnabled
                      ? 'Admin tab is visible, replacing the profile tab in navigation.'
                      : 'Enable to show admin tab in navigation bar.'}
                  </Text>
                </View>
              </View>
              <Switch
                value={isAdminTabEnabled}
                onValueChange={handleAdminTabToggle}
                trackColor={{ false: theme.border, true: theme.primary }}
                thumbColor={isAdminTabEnabled ? theme.primary : theme.textDisabled}
                accessibilityLabel="Toggle admin tab visibility"
              />
            </View>
          </View>
        )}

        <SettingsCard
          theme={theme}
          title="Legal: Terms & Privacy"
          description="Read our Terms of Service and Privacy Policy."
          primaryLabel="View"
          onPrimary={() => setPanel('terms')}
          icon="gavel"
        />

        <SettingsCard
          theme={theme}
          title="Community Guidelines"
          description="Learn about our community standards for safety, trust, and respectful behavior."
          primaryLabel="View Guidelines"
          onPrimary={() => router.push('/legal/community-guidelines')}
          icon="security"
        />

        <SettingsCard
          theme={theme}
          title="Log Out"
          description="Sign out of the application securely and end your current session."
          primaryLabel="Confirm Log Out"
          onPrimary={async () => {
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
          }}
          icon="logout"
        />

        <SettingsCard
          theme={theme}
          title="Delete Account"
          description="Permanently delete your account and all associated data. This action cannot be undone."
          primaryLabel="Delete Account"
          onPrimary={async () => {
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
                    const {
                      deleteUserAccount,
                    } = require('../lib/services/account-deletion-service');
                    const currentUserId = authProfile?.id;
                    if (!currentUserId) {
                      Alert.alert(
                        'Error',
                        'Unable to identify user account. Please sign in again.'
                      );
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
                              Alert.alert(
                                'Error',
                                'Failed to delete account. Please try again or contact support.'
                              );
                            }
                          },
                        },
                      ]
                    );
                  },
                },
              ]
            );
          }}
          icon="delete-forever"
        />

        <View className="mt-6 mb-10 items-center">
          <TouchableOpacity
            onPress={onBack}
            style={s.backButton}
            className="px-4 py-2 rounded-md"
            accessibilityRole="button"
            accessibilityLabel="Back to home"
          >
            <Text style={s.backButtonText} className="text-sm font-medium">
              Back to Home
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

// ─── SettingsCard ──────────────────────────────────────────────────────────────

interface SettingsCardProps {
  theme: AppTheme;
  title: string;
  description: string;
  primaryLabel: string;
  secondaryLabel?: string;
  onPrimary: () => void;
  onSecondary?: () => void;
  icon: any;
}

function SettingsCard({
  theme,
  title,
  description,
  primaryLabel,
  secondaryLabel,
  onPrimary,
  onSecondary,
  icon,
}: SettingsCardProps) {
  const s = makeStyles(theme);
  return (
    <View style={s.card} className="rounded-xl p-4 mb-4">
      <View className="flex-row items-center mb-2">
        <MaterialIcons name={icon} size={22} color={theme.primaryLight} />
        <Text style={s.cardTitle} className="ml-2 font-medium text-sm flex-1" numberOfLines={1}>
          {title}
        </Text>
      </View>
      <Text style={s.cardDescription} className="text-xs leading-4 mb-3" numberOfLines={4}>
        {description}
      </Text>
      <View className="flex-row gap-2">
        <TouchableOpacity
          onPress={onPrimary}
          style={s.primaryButton}
          className="px-3 py-1 rounded-md"
          accessibilityRole="button"
          accessibilityLabel={primaryLabel}
        >
          <Text style={s.primaryButtonText} className="text-xs font-medium">
            {primaryLabel}
          </Text>
        </TouchableOpacity>
        {secondaryLabel && onSecondary && (
          <TouchableOpacity
            onPress={onSecondary}
            style={s.secondaryButton}
            className="px-3 py-1 rounded-md"
            accessibilityRole="button"
            accessibilityLabel={secondaryLabel}
          >
            <Text style={s.cardTitle} className="text-xs font-medium">
              {secondaryLabel}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
    screen: { backgroundColor: theme.background },
    pageTitle: { color: theme.text },
    card: { backgroundColor: theme.surface },
    cardTitle: { color: theme.text },
    cardDescription: { color: theme.textSecondary },
    primaryButton: { backgroundColor: theme.primary },
    primaryButtonText: { color: '#ffffff' },
    secondaryButton: { backgroundColor: theme.surfaceSecondary },
    themeChipActive: { backgroundColor: theme.primary, borderColor: theme.primary },
    themeChipInactive: { backgroundColor: theme.surfaceSecondary, borderColor: theme.border },
    themeChipLabelActive: { color: '#ffffff' },
    themeChipLabelInactive: { color: theme.textSecondary },
    backButton: { backgroundColor: theme.surfaceSecondary },
    backButtonText: { color: theme.text },
  });
}
