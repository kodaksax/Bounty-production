"use client"

import { MaterialIcons } from "@expo/vector-icons"
import React, { useState } from "react"
import { Alert, ScrollView, Text, TouchableOpacity, View } from "react-native"
import { ContactSupportScreen } from "../../components/settings/contact-support-screen"
import { FAQScreen } from "../../components/settings/faq-screen"
import { HelpSupportScreen } from "../../components/settings/help-support-screen"
import { NotificationsCenterScreen } from "../../components/settings/notifications-center-screen"
import { PrivacySecurityScreen } from "../../components/settings/privacy-security-screen"
import { TermsPrivacyScreen } from "../../components/settings/terms-privacy-screen"
import { EditProfileScreen } from "./edit-profile-screen"

interface SettingsScreenProps { onBack?: () => void }

type Panel = 'root' | 'editProfile' | 'privacy' | 'notifications' | 'help' | 'contact' | 'terms' | 'faq'

export function SettingsScreen({ onBack }: SettingsScreenProps = {}) {
  const [panel, setPanel] = useState<Panel>('root')
  const [profileData, setProfileData] = useState({
    name: '@jon_Doe',
    about: 'Russian opportunist',
    phone: '+998 90 943 32 00',
    avatar: '/placeholder.svg?height=48&width=48',
  })

  const handleProfileSave = (data: { name: string; about: string; phone: string }) => {
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
        <SettingsCard
          title="Log Out"
          description="Sign out of the application securely and end your current session."
          primaryLabel="Confirm Log Out"
          onPrimary={() => Alert.alert('Logged Out', 'Session ended (placeholder).')}
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
