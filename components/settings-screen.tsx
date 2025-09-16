"use client"

import { MaterialIcons } from "@expo/vector-icons"
import { Avatar, AvatarFallback, AvatarImage } from "components/ui/avatar"
import React, { useState } from "react"
import { StyleSheet, Text, TouchableOpacity, View } from "react-native"
import { EditProfileScreen } from "./edit-profile-screen"

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

    <View className="flex flex-col min-h-screen bg-emerald-600 text-white">
      {/* Header */}
      <View className="flex justify-between items-center p-4 pt-8">
        <View className="flex items-center">
          <MaterialIcons name="gps-fixed" size={24} color="#000000" />
          <Text className="text-lg font-bold tracking-wider">BOUNTY</Text>
        </View>
        <Text className="text-lg font-bold">$ 40.00</Text>
      </View>

      {/* Back button and title */}
      <View className="px-4 py-2 flex items-center">
        <TouchableOpacity onPress={onBack} className="mr-2">
          <MaterialIcons name="arrow-back" size={24} color="#000000" />
        </TouchableOpacity>
        <Text className="text-xl font-medium">Settings</Text>
      </View>

      {/* Profile section */}
      <View className="px-4 py-3 bg-emerald-700/30">
        <TouchableOpacity className="flex-row items-center justify-between" onPress={() => setShowEditProfile(true)}>
          <View className="flex-row items-center">
            <Avatar className="h-12 w-12 mr-3 border-2 border-white">
              <AvatarImage src={profileData.avatar} alt={profileData.name} />
              <AvatarFallback>JD</AvatarFallback>
            </Avatar>
            <View>
              <Text className="font-medium">{profileData.name}</Text>
              <Text className="text-xs text-emerald-200">{profileData.about}</Text>
            </View>
          </View>
          <MaterialIcons name="keyboard-arrow-right" size={24} color="#000000" />
        </TouchableOpacity>
      </View>

      {/* Settings options */}
      <View className="flex-1">
        <View className="py-2">
          <SettingsItem icon={<MaterialIcons name="star" size={24} color="#000000" />} label="Starred Messages" />
          <SettingsItem icon={<MaterialIcons name="laptop" size={24} color="#14b8a6" />} label="WhatsApp Web/Desktop" />
          <SettingsItem icon={<MaterialIcons name="person" size={24} color="#000000" />} label="Account" />
          <SettingsItem icon={<MaterialIcons name="chat" size={24} color="#000000" />} label="Chats" />
          <SettingsItem icon={<MaterialIcons name="notifications" size={24} color="#000000" />} label="Notifications" />
          <SettingsItem icon={<MaterialIcons name="storage" size={24} color="#8b5cf6" />} label="Data and Storage Usage" />
          <SettingsItem icon={<MaterialIcons name="help" size={24} color="#3b82f6" />} label="Help" />
          <SettingsItem icon={<MaterialIcons name="favorite" size={24} color="#000000" />} label="Tell a Friend" />
        </View>
      </View>

      {/* Bottom Navigation Indicator */}
      <View className="mt-auto flex justify-center pb-6">
        <View className="h-1 w-1 rounded-full bg-white/50 mx-1"></View>
        <View className="h-1 w-1 rounded-full bg-white/50 mx-1"></View>
        <View className="h-1 w-1 rounded-full bg-white/50 mx-1"></View>
        <View className="h-1 w-1 rounded-full bg-white/50 mx-1"></View>
        <View className="h-1 w-1 rounded-full bg-white/50 mx-1"></View>

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
      className="w-full flex-row items-center justify-between px-4 py-3"
      onPress={onClick}
    >
      <View className="flex-row items-center">
        {icon}
        <Text className="ml-3">{label}</Text>
      </View>
      <MaterialIcons name="keyboard-arrow-right" size={24} color="#000000" />
    </TouchableOpacity>
  )
}
