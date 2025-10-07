"use client"

import { MaterialIcons } from "@expo/vector-icons"
import React, { useState } from "react"
import { Alert, ScrollView, Switch, Text, TouchableOpacity, View } from "react-native"
import { useAdmin } from "../lib/admin-context"
import { EditProfileScreen } from "./edit-profile-screen"
import { ContactSupportScreen } from "./settings/contact-support-screen"
import { FAQScreen } from "./settings/faq-screen"
import { HelpSupportScreen } from "./settings/help-support-screen"
import { NotificationsCenterScreen } from "./settings/notifications-center-screen"
import { PrivacySecurityScreen } from "./settings/privacy-security-screen"
import { TermsPrivacyScreen } from "./settings/terms-privacy-screen"

interface SettingsScreenProps {
  onBack?: () => void
  navigation?: any // Accept navigation prop for navigation actions
}

type Panel = 'root' | 'editProfile' | 'privacy' | 'notifications' | 'help' | 'contact' | 'terms' | 'faq'

export function SettingsScreen({ onBack, navigation }: SettingsScreenProps = {}) {
  const [panel, setPanel] = useState<Panel>('root')
  const { isAdmin, setIsAdmin } = useAdmin()
  const [profileData, setProfileData] = useState({
    name: '@jon_Doe',
    about: 'Russian opportunist',
    phone: '+998 90 943 32 00',
    avatar: '/placeholder.svg?height=48&width=48',
  })

  const handleAdminToggle = async (value: boolean) => {
    await setIsAdmin(value)
    Alert.alert(
      value ? 'Admin Mode Enabled' : 'Admin Mode Disabled',
      value ? 'You now have access to the admin panel.' : 'Admin access has been removed.',
      [{ text: 'OK' }]
    )
  }

  const handleProfileSave = (data: { name: string; about: string; phone: string; avatar?: string }) => {
    setProfileData(prev => ({ ...prev, ...data }))
    setPanel('root')
  }

  // Panel routing
  if (panel === 'editProfile') {
    return (
      <EditProfileScreen
        onBack={() => setPanel('root')}
        initialName={profileData.name}
        initialAbout={profileData.about}
        initialPhone={profileData.phone}
        initialAvatar={profileData.avatar}
        onSave={handleProfileSave}
      />
    )
  }
  if (panel === 'privacy') return <PrivacySecurityScreen onBack={() => setPanel('root')} />
  if (panel === 'notifications') return <NotificationsCenterScreen onBack={() => setPanel('root')} />
  if (panel === 'help') return <HelpSupportScreen onBack={() => setPanel('root')} onNavigateContact={() => setPanel('contact')} onNavigateTerms={() => setPanel('terms')} onNavigateFAQ={() => setPanel('faq')} />
  if (panel === 'contact') return <ContactSupportScreen onBack={() => setPanel('help')} />
  if (panel === 'terms') return <TermsPrivacyScreen onBack={() => setPanel('help')} />
  if (panel === 'faq') return <FAQScreen onBack={() => setPanel('help')} />

  // Root panel
  return (
    <View className="flex-1 bg-emerald-600">
      {/* Header */}
      <View className="flex-row justify-between items-center p-4 pt-8">
        <View className="flex-row items-center">
          <MaterialIcons name="gps-fixed" size={24} color="#000" />
          <Text className="text-lg font-bold tracking-wider ml-2 text-black">BOUNTY</Text>
        </View>
        <TouchableOpacity onPress={onBack} accessibilityRole="button" accessibilityLabel="Back">
          <MaterialIcons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>
      </View>
      <ScrollView className="px-4" contentContainerStyle={{ paddingBottom: 96 }}>
        <Text className="text-xl font-semibold text-white mb-4 text-center">Settings</Text>
        {/* Cards */}
        <SettingsCard
          title="Edit Profile"
          description="Allows users to modify their personal information such as name, profile picture, contact details, and update their role preferences. It provides"
          primaryLabel="Save Changes"
          secondaryLabel="View My Profile"
          onPrimary={() => setPanel('editProfile')}
          onSecondary={() => setPanel('editProfile')}
          icon="person"
        />
        <SettingsCard
          title="Privacy & Security Settings"
            description="Provides users with options to manage their account's privacy and security, including password changes, two-factor authentication"
          primaryLabel="Open"
          onPrimary={() => setPanel('privacy')}
          icon="lock"
        />
        <SettingsCard
          title="Notifications Center"
          description="Aggregates all in-app notifications, such as new applicants, task assignments, payment updates, and reminders, in a chronological feed."
          primaryLabel="Open"
          onPrimary={() => setPanel('notifications')}
          icon="notifications"
        />
        <SettingsCard
          title="Help & Support"
          description="Offers various resources for user assistance, including FAQs, a direct contact form for support inquiries, and links to legal documentation."
          primaryLabel="Open"
          onPrimary={() => setPanel('help')}
          icon="help-center"
        />
        
        {/* Dev Tools Section (only visible in __DEV__ mode) */}
        {__DEV__ && (
          <View className="mt-6 mb-4">
            <Text className="text-white/70 text-xs font-semibold uppercase tracking-wider mb-3 px-2">Developer Tools</Text>
            <View className="bg-emerald-700/50 rounded-lg p-4 border border-emerald-500/30">
              <View className="flex-row justify-between items-center mb-2">
                <View className="flex-row items-center gap-2">
                  <MaterialIcons name="admin-panel-settings" size={20} color="#00dc50" />
                  <Text className="text-white font-semibold">Admin Mode</Text>
                </View>
                <Switch
                  value={isAdmin}
                  onValueChange={handleAdminToggle}
                  trackColor={{ false: '#374151', true: '#00912C' }}
                  thumbColor={isAdmin ? '#00dc50' : '#9ca3af'}
                />
              </View>
              <Text className="text-white/60 text-xs leading-5">
                Enable admin access to view and manage bounties, users, and transactions.
              </Text>
            </View>
          </View>
        )}
        
        <SettingsCard
          title="Log Out"
          description="Sign out of the application securely and end your current session."
          primaryLabel="Confirm Log Out"
          secondaryLabel="devSignOut"
          onPrimary={async () => {
            try {
              // Lazy imports to avoid bundling server-only code
              // Use the shared supabase client
              // eslint-disable-next-line @typescript-eslint/no-var-requires
              const { supabase } = require('../lib/supabase');
              // SecureStore to clear tokens
              // eslint-disable-next-line @typescript-eslint/no-var-requires
              const SecureStore = require('expo-secure-store');

              // Sign out from Supabase
              const { error } = await supabase.auth.signOut();
              if (error) {
                console.error('[Logout] Supabase signout error:', error);
                Alert.alert('Sign Out Failed', 'Unable to sign out. Please try again.');
                return;
              }

              // Clear any stored tokens (best-effort)
              try {
                await SecureStore.deleteItemAsync('sb-access-token');
                await SecureStore.deleteItemAsync('sb-refresh-token');
              } catch (e) {
                // Not critical; log and continue
                console.warn('[Logout] SecureStore cleanup failed', e);
              }

              // Route to sign-in screen using expo-router
              try {
                // eslint-disable-next-line @typescript-eslint/no-var-requires
                const { router } = require('expo-router');
                if (router && typeof router.replace === 'function') {
                  router.replace('/auth/sign-in-form');
                }
              } catch (e) {
                console.warn('[Logout] Router navigation failed', e);
              }

              Alert.alert('Logged Out', 'You have been signed out successfully.');
            } catch (e) {
              console.error('[Logout] Error:', e);
              Alert.alert('Error', 'Failed to log out properly.');
            }
          }}
          onSecondary={() => {
            // Developer shortcut to go directly to SignUp screen
            try {
              if (navigation && typeof navigation.navigate === 'function') {
                navigation.navigate('SignUp');
              } else {
                // Lazy import to avoid bundling if not needed
                try {
                  // eslint-disable-next-line @typescript-eslint/no-var-requires
                  const router = require('expo-router').router;
                  if (router) router.push('/auth/sign-up-form');
                } catch {}
              }
            } catch (e) {
              console.warn('[devSignOut] navigation failed', e);
            }
          }}
          icon="logout"
        />
        <View className="mt-6 mb-10">
          <TouchableOpacity onPress={onBack} className="mx-auto px-4 py-2 rounded-md bg-black/30">
            <Text className="text-white text-sm font-medium">Back to Home</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  )
}

interface SettingsItemProps {
  icon: React.ReactNode
  label: string
  onClick?: () => void
}

function SettingsItem({ icon, label, onClick }: SettingsItemProps) {
  return (
    <TouchableOpacity className="w-full flex-row items-center justify-between px-4 py-3" onPress={onClick}>
      <View className="flex-row items-center">
        {icon}
        <Text className="ml-3">{label}</Text>
      </View>
      <MaterialIcons name="keyboard-arrow-right" size={24} color="#000" />
    </TouchableOpacity>
  )
}

interface SettingsCardProps {
  title: string
  description: string
  primaryLabel: string
  secondaryLabel?: string
  onPrimary: () => void
  onSecondary?: () => void
  icon: any
}

const SettingsCard = ({ title, description, primaryLabel, secondaryLabel, onPrimary, onSecondary, icon }: SettingsCardProps) => {
  return (
    <View className="bg-black/30 rounded-xl p-4 mb-4">
      <View className="flex-row items-center mb-2">
        <MaterialIcons name={icon} size={22} color="#34d399" />
        <Text className="ml-2 text-white font-medium text-sm flex-1" numberOfLines={1}>{title}</Text>
      </View>
      <Text className="text-emerald-200 text-xs leading-4 mb-3" numberOfLines={4}>{description}</Text>
      <View className="flex-row gap-2">
        <TouchableOpacity onPress={onPrimary} className="px-3 py-1 rounded-md bg-emerald-700">
          <Text className="text-white text-xs font-medium">{primaryLabel}</Text>
        </TouchableOpacity>
        {secondaryLabel && onSecondary && (
          <TouchableOpacity onPress={onSecondary} className="px-3 py-1 rounded-md bg-black/40">
            <Text className="text-white text-xs font-medium">{secondaryLabel}</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  )
}
