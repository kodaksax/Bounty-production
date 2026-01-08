"use client"

import { MaterialIcons } from "@expo/vector-icons"
import { BrandingLogo } from "components/ui/branding-logo"
import { router } from 'expo-router'
import React, { useState } from "react"
import { Alert, ScrollView, Switch, Text, TouchableOpacity, View } from "react-native"
import { useAuthProfile } from "../hooks/useAuthProfile"
import { useNormalizedProfile } from "../hooks/useNormalizedProfile"
import { useAdmin } from "../lib/admin-context"
import { clearRememberMePreference } from "../lib/auth-session-storage"
import { markIntentionalSignOut } from "../lib/utils/session-handler"
import { EditProfileScreen } from "./edit-profile-screen"
import { ContactSupportScreen } from "./settings/contact-support-screen"
import { FAQScreen } from "./settings/faq-screen"
import { HelpSupportScreen } from "./settings/help-support-screen"
import { LocationSettingsScreen } from "./settings/location-settings-screen"
import { NotificationsCenterScreen } from "./settings/notifications-center-screen"
import { PrivacySecurityScreen } from "./settings/privacy-security-screen"
import { TermsPrivacyScreen } from "./settings/terms-privacy-screen"

interface SettingsScreenProps {
  onBack?: () => void
  navigation?: any // Accept navigation prop for navigation actions
}

type Panel = 'root' | 'editProfile' | 'privacy' | 'notifications' | 'location' | 'help' | 'contact' | 'terms' | 'faq'

export function SettingsScreen({ onBack, navigation }: SettingsScreenProps = {}) {
  const [panel, setPanel] = useState<Panel>('root')
  const { isAdmin, isAdminTabEnabled, setAdminTabEnabled } = useAdmin()
  
  // Import profile hooks to get real profile data
  const { profile: authProfile } = useAuthProfile()
  const { profile: normalizedProfile } = useNormalizedProfile()
  
  // Use actual profile data from auth or normalized profile
  const profileData = {
    name: authProfile?.username || normalizedProfile?.username || '@user',
    about: authProfile?.about || normalizedProfile?.bio || '',
    phone: '+998 90 943 32 00', // Phone is private, not exposed
    avatar: authProfile?.avatar || normalizedProfile?.avatar || '/placeholder.svg?height=48&width=48',
  }

  const handleAdminTabToggle = async (value: boolean) => {
    await setAdminTabEnabled(value)
    Alert.alert(
      value ? 'Admin Tab Enabled' : 'Admin Tab Disabled',
      value ? 'The admin tab is now visible in the bottom navigation, replacing the profile tab.' : 'The admin tab has been hidden. Profile tab is now visible.',
      [{ text: 'OK' }]
    )
  }

  const handleProfileSave = (data: { name: string; about: string; phone: string; avatar?: string }) => {
    // Profile updates are handled by authProfileService subscribers
    // Just return to root panel - the profile will update automatically
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
  if (panel === 'location') return <LocationSettingsScreen onBack={() => setPanel('root')} />
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
          <BrandingLogo size="medium" />
        </View>
        <TouchableOpacity onPress={onBack} accessibilityRole="button" accessibilityLabel="Back">
          <MaterialIcons name="arrow-back" size={24} color="#fff" />
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
          title="Location & Visibility"
          description="Manage location permissions, saved addresses, and control how location data is used for finding nearby bounties and distance calculations."
          primaryLabel="Open"
          onPrimary={() => setPanel('location')}
          icon="place"
        />
        <SettingsCard
          title="Help & Support"
          description="Offers various resources for user assistance, including FAQs, a direct contact form for support inquiries, and links to legal documentation."
          primaryLabel="Open"
          onPrimary={() => setPanel('help')}
          icon="help-center"
        />
        
        {/* Admin Tab Toggle - only visible to users with admin permissions */}
        {isAdmin && (
          <View className="bg-black/30 rounded-xl p-4 mb-4">
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center flex-1">
                <MaterialIcons name="admin-panel-settings" size={22} color="#34d399" />
                <View className="ml-2 flex-1">
                  <Text className="text-white font-medium text-sm">Admin Tab</Text>
                  <Text className="text-emerald-200 text-xs leading-4 mt-1" numberOfLines={2}>
                    {isAdminTabEnabled 
                      ? 'Admin tab is visible, replacing the profile tab in navigation.' 
                      : 'Enable to show admin tab in navigation bar.'}
                  </Text>
                </View>
              </View>
              <Switch
                value={isAdminTabEnabled}
                onValueChange={handleAdminTabToggle}
                trackColor={{ false: '#374151', true: '#10b981' }}
                thumbColor={isAdminTabEnabled ? '#34d399' : '#9ca3af'}
                accessibilityLabel="Toggle admin tab visibility"
                accessibilityHint={isAdminTabEnabled ? 'Disable to hide admin tab' : 'Enable to show admin tab in navigation'}
              />
            </View>
          </View>
        )}
        
        <SettingsCard
          title="Legal: Terms & Privacy"
          description="Read our Terms of Service and Privacy Policy."
          primaryLabel="View"
          onPrimary={() => setPanel('terms')}
          icon="gavel"
        />
        
        <SettingsCard
          title="Community Guidelines"
          description="Learn about our community standards for safety, trust, and respectful behavior."
          primaryLabel="View Guidelines"
          onPrimary={() => {
            router.push('/legal/community-guidelines');
          }}
          icon="security"
        />
        
        {/* Log Out - placed directly after Legal */}
        <SettingsCard
          title="Log Out"
          description="Sign out of the application securely and end your current session."
          primaryLabel="Confirm Log Out"
          onPrimary={async () => {
            try {
              // Lazy imports to avoid bundling server-only code
              // Use the shared supabase client
               
              const { supabase } = require('../lib/supabase');
              // SecureStore to clear tokens
               
              const SecureStore = require('expo-secure-store');
              // Auth profile service to clear drafts
               
              const { authProfileService } = require('../lib/services/auth-profile-service');

              // Get current user ID before signing out
              const currentUserId = authProfile?.id;

              // Mark this as an intentional sign-out to prevent "Session Expired" alert
              markIntentionalSignOut();

              // OPTIMIZATION: Sign out locally first for immediate response
              // Server sign-out will be attempted in background
              await supabase.auth.signOut({ scope: 'local' });

              // OPTIMIZATION: Navigate immediately after local sign-out for perceived speed
              // Navigation itself provides sufficient feedback to the user
              try {
                 
                const { router } = require('expo-router');
                if (router && typeof router.replace === 'function') {
                  router.replace('/auth/sign-in-form');
                }
              } catch (e) {
                console.error('[Logout] Router navigation failed', e);
              }

              // OPTIMIZATION: Run cleanup operations in background (non-blocking)
              // These operations don't need to block the user experience
              // Using void to explicitly indicate fire-and-forget behavior
              void Promise.all([
                // Clear remember me preference
                clearRememberMePreference().catch((e: any) => 
                  console.error('[Logout] Failed to clear remember me preference', e)
                ),
                // Clear user-specific draft data
                currentUserId ? authProfileService.clearUserDraftData(currentUserId).catch((e: any) =>
                  console.error('[Logout] Draft cleanup failed', e)
                ) : Promise.resolve(),
                // Clear stored tokens (best-effort)
                Promise.all([
                  SecureStore.deleteItemAsync('sb-access-token').catch((e: any) => 
                    console.error('[Logout] Failed to delete sb-access-token', e)
                  ),
                  SecureStore.deleteItemAsync('sb-refresh-token').catch((e: any) =>
                    console.error('[Logout] Failed to delete sb-refresh-token', e)
                  )
                ]),
                // Attempt server sign-out in background (best-effort)
                // Note: This calls signOut() without scope, which will attempt both local and server.
                // Since local is already cleared, this effectively only does server-side cleanup.
                supabase.auth.signOut().catch((e: any) => 
                  console.error('[Logout] Background server signout failed (non-critical)', e)
                )
              ]).catch(e => {
                // Log but don't show error - user is already logged out
                console.error('[Logout] Background cleanup errors (non-critical)', e);
              });
            } catch (e) {
              console.error('[Logout] Error:', e);
              Alert.alert('Error', 'Failed to log out properly.');
            }
          }}
          icon="logout"
        />
        <SettingsCard
          title="Delete Account"
          description="Permanently delete your account and all associated data. This action cannot be undone."
          primaryLabel="Delete Account"
          onPrimary={async () => {
            // Show confirmation dialog
            Alert.alert(
              'Delete Account',
              'Are you sure you want to delete your account? This will permanently delete:\n\n• Your profile and personal information\n• All your bounties (posted and accepted)\n• Your wallet transactions and balance\n• All messages and conversations\n• All notifications and settings\n\nThis action cannot be undone.',
              [
                {
                  text: 'Cancel',
                  style: 'cancel',
                },
                {
                  text: 'Delete',
                  style: 'destructive',
                  onPress: async () => {
                    // Lazy imports
                     
                    const { supabase } = require('../lib/supabase');
                     
                    const SecureStore = require('expo-secure-store');
                     
                    const { authProfileService } = require('../lib/services/auth-profile-service');
                     
                    const { deleteUserAccount } = require('../lib/services/account-deletion-service');

                    // Get current user ID before deleting
                    const currentUserId = authProfile?.id;

                    if (!currentUserId) {
                      Alert.alert('Error', 'Unable to identify user account. Please sign in again and try again.');
                      return;
                    }

                    // Show a second confirmation dialog with loading option
                    Alert.alert(
                      'Final Confirmation',
                      'This will permanently delete your account. Are you absolutely sure?',
                      [
                        {
                          text: 'Cancel',
                          style: 'cancel',
                        },
                        {
                          text: 'Yes, Delete',
                          style: 'destructive',
                          onPress: async () => {
                            try {
                              // Mark this as an intentional sign-out to prevent "Session Expired" alert
                              markIntentionalSignOut();

                              // Delete user account and associated data
                              const result = await deleteUserAccount();
                              
                              if (!result.success) {
                                console.error('[DeleteAccount] Deletion failed:', result.message);
                                Alert.alert('Deletion Failed', result.message);
                                return;
                              }

                              // Clear user-specific draft data
                              try {
                                await authProfileService.clearUserDraftData(currentUserId);
                              } catch (e) {
                                console.error('[DeleteAccount] Draft cleanup failed', e);
                              }

                              // Clear any stored tokens
                              try {
                                await SecureStore.deleteItemAsync('sb-access-token');
                                await SecureStore.deleteItemAsync('sb-refresh-token');
                              } catch (e) {
                                console.error('[DeleteAccount] SecureStore cleanup failed', e);
                              }

                              // Sign out (may already be done by deleteUserAccount)
                              // Let Supabase SDK handle network timeouts and retry logic
                              try {
                                await supabase.auth.signOut();
                              } catch (e) {
                                console.error('[DeleteAccount] Sign out failed', e);
                              }

                              // Route to sign-in screen
                              try {
                                 
                                const { router } = require('expo-router');
                                if (router && typeof router.replace === 'function') {
                                  router.replace('/auth/sign-in-form');
                                }
                              } catch (e) {
                                console.error('[DeleteAccount] Router navigation failed', e);
                              }

                              Alert.alert('Account Deleted', result.message || 'Your account has been permanently deleted.');
                            } catch (e) {
                              console.error('[DeleteAccount] Error:', e);
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
          }}
          icon="delete-forever"
        />
        <View className="mt-6 mb-10">
          <TouchableOpacity accessibilityRole="button" onPress={onBack} className="mx-auto px-4 py-2 rounded-md bg-black/30">
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
    <TouchableOpacity accessibilityRole="button" className="w-full flex-row items-center justify-between px-4 py-3" onPress={onClick}>
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
        <TouchableOpacity accessibilityRole="button" onPress={onPrimary} className="px-3 py-1 rounded-md bg-emerald-700">
          <Text className="text-white text-xs font-medium">{primaryLabel}</Text>
        </TouchableOpacity>
        {secondaryLabel && onSecondary && (
          <TouchableOpacity accessibilityRole="button" onPress={onSecondary} className="px-3 py-1 rounded-md bg-black/40">
            <Text className="text-white text-xs font-medium">{secondaryLabel}</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  )
}
