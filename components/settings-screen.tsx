"use client"

import type React from "react"

import {
  ArrowLeft,
  Bell,
  ChevronRight,
  Database,
  HelpCircle,
  Heart,
  MessageSquare,
  Star,
  Target,
  User,
  Laptop,
} from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "components/ui/avatar"
import { useState } from "react"
import { EditProfileScreen } from "./edit-profile-screen"
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';

interface SettingsScreenProps {
  onBack?: () => void
}

export function SettingsScreen({ onBack }: SettingsScreenProps = {}) {
  const [showEditProfile, setShowEditProfile] = useState(false)
  const [profileData, setProfileData] = useState({
    name: "@jon_Doe",
    about: "Russian opportunist",
    phone: "+998 90 943 32 00",
    avatar: "/placeholder.svg?height=48&width=48",
  })

  const handleProfileSave = (data: { name: string; about: string; phone: string }) => {
    setProfileData({
      ...profileData,
      ...data,
    })
    setShowEditProfile(false)
  }

  if (showEditProfile) {
    return (
      <EditProfileScreen
        onBack={() => setShowEditProfile(false)}
        initialName={profileData.name}
        initialAbout={profileData.about}
        initialPhone={profileData.phone}
        initialAvatar={profileData.avatar}
        onSave={handleProfileSave}
      />
    )
  }

  const styles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: '#059669', // emerald-600
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: 16,
      paddingTop: 32,
    },
    headerContent: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    headerIcon: {
      marginRight: 8,
    },
    headerTitle: {
      fontSize: 18,
      fontWeight: 'bold',
      color: 'white',
      letterSpacing: 2,
    },
    balanceText: {
      fontSize: 18,
      fontWeight: 'bold',
      color: 'white',
    },
    backContainer: {
      paddingHorizontal: 16,
      paddingVertical: 8,
      flexDirection: 'row',
      alignItems: 'center',
    },
    backButton: {
      marginRight: 8,
    },
    titleText: {
      fontSize: 20,
      fontWeight: '500',
      color: 'white',
    },
    profileSection: {
      paddingHorizontal: 16,
      paddingVertical: 12,
      backgroundColor: 'rgba(6, 95, 70, 0.3)', // emerald-700/30
    },
    profileContent: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    profileInfo: {
      flexDirection: 'row',
      alignItems: 'center',
      flex: 1,
    },
    avatarContainer: {
      marginRight: 12,
    },
    profileName: {
      fontWeight: '500',
      color: 'white',
      fontSize: 16,
    },
    profileAbout: {
      fontSize: 12,
      color: '#A7F3D0', // emerald-200
    },
    settingsContainer: {
      flex: 1,
    },
    settingsContent: {
      paddingVertical: 8,
    },
    navigationIndicator: {
      marginTop: 'auto',
      flexDirection: 'row',
      justifyContent: 'center',
      paddingBottom: 24,
    },
    indicator: {
      height: 4,
      width: 4,
      borderRadius: 2,
      backgroundColor: 'rgba(255, 255, 255, 0.5)',
      marginHorizontal: 4,
    },
    settingsItem: {
      width: '100%',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    settingsItemContent: {
      flexDirection: 'row',
      alignItems: 'center',
      flex: 1,
    },
    settingsItemIcon: {
      marginRight: 12,
    },
    settingsItemLabel: {
      color: 'white',
      fontSize: 16,
    },
  });

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <Target color="white" size={20} style={styles.headerIcon} />
          <Text style={styles.headerTitle}>BOUNTY</Text>
        </View>
        <Text style={styles.balanceText}>$ 40.00</Text>
      </View>

      {/* Back button and title */}
      <View style={styles.backContainer}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <ArrowLeft color="white" size={20} />
        </TouchableOpacity>
        <Text style={styles.titleText}>Settings</Text>
      </View>

      {/* Profile section */}
      <TouchableOpacity style={styles.profileSection} onPress={() => setShowEditProfile(true)}>
        <View style={styles.profileContent}>
          <View style={styles.profileInfo}>
            <View style={styles.avatarContainer}>
              <Avatar>
                <AvatarImage src={profileData.avatar} alt={profileData.name} />
                <AvatarFallback>JD</AvatarFallback>
              </Avatar>
            </View>
            <View>
              <Text style={styles.profileName}>{profileData.name}</Text>
              <Text style={styles.profileAbout}>{profileData.about}</Text>
            </View>
          </View>
          <ChevronRight color="#6EE7B7" size={20} />
        </View>
      </TouchableOpacity>

      {/* Settings options */}
      <View style={styles.settingsContainer}>
        <ScrollView style={styles.settingsContent}>
          <SettingsItem icon={<Star color="#FCD34D" size={20} />} label="Starred Messages" />
          <SettingsItem icon={<Laptop color="#14B8A6" size={20} />} label="WhatsApp Web/Desktop" />
          <SettingsItem icon={<User color="#60A5FA" size={20} />} label="Account" />
          <SettingsItem icon={<MessageSquare color="#34D399" size={20} />} label="Chats" />
          <SettingsItem icon={<Bell color="#F87171" size={20} />} label="Notifications" />
          <SettingsItem icon={<Database color="#A78BFA" size={20} />} label="Data and Storage Usage" />
          <SettingsItem icon={<HelpCircle color="#60A5FA" size={20} />} label="Help" />
          <SettingsItem icon={<Heart color="#F87171" size={20} />} label="Tell a Friend" />
        </ScrollView>
      </View>

      {/* Bottom Navigation Indicator */}
      <View style={styles.navigationIndicator}>
        <View style={styles.indicator} />
        <View style={styles.indicator} />
        <View style={styles.indicator} />
        <View style={styles.indicator} />
        <View style={styles.indicator} />
      </View>
    </View>
  )
}

interface SettingsItemProps {
  icon: React.ReactNode
  label: string
  onClick?: () => void
}

function SettingsItem({ icon, label, onClick }: SettingsItemProps) {
  const styles = StyleSheet.create({
    settingsItem: {
      width: '100%',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    settingsItemContent: {
      flexDirection: 'row',
      alignItems: 'center',
      flex: 1,
    },
    settingsItemIcon: {
      marginRight: 12,
    },
    settingsItemLabel: {
      color: 'white',
      fontSize: 16,
    },
  });

  return (
    <TouchableOpacity
      style={styles.settingsItem}
      onPress={onClick}
    >
      <View style={styles.settingsItemContent}>
        <View style={styles.settingsItemIcon}>
          {icon}
        </View>
        <Text style={styles.settingsItemLabel}>{label}</Text>
      </View>
      <ChevronRight color="#6EE7B7" size={20} />
    </TouchableOpacity>
  )
}
