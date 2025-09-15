"use client"

import type React from "react"
import { View, Text, TouchableOpacity } from "react-native"

import { MaterialIcons } from "@expo/vector-icons"
import { Avatar, AvatarFallback, AvatarImage } from "components/ui/avatar"
import { useState } from "react"
import { View, Text, TouchableOpacity } from "react-native"
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
        <View className="flex items-center justify-between" onPress={() => setShowEditProfile(true)}>
          <View className="flex items-center">
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
        </View>
      </View>

      {/* Settings options */}
      <View className="flex-1">
        <View className="py-2">
          <SettingsItem icon={<MaterialIcons name="star" size={24} color="#000000" />} label="Starred Messages" />
          <SettingsItem icon={<Laptop className="h-5 w-5 text-teal-400" />} label="WhatsApp Web/Desktop" />
          <SettingsItem icon={<MaterialIcons name="person" size={24} color="#000000" />} label="Account" />
          <SettingsItem icon={<MaterialIcons name="chat" size={24} color="#000000" />} label="Chats" />
          <SettingsItem icon={<MaterialIcons name="notifications" size={24} color="#000000" />} label="Notifications" />
          <SettingsItem icon={<Database className="h-5 w-5 text-purple-400" />} label="Data and Storage Usage" />
          <SettingsItem icon={<HelpCircle className="h-5 w-5 text-blue-400" />} label="Help" />
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
  return (
    <TouchableOpacity
      style="w-full flex items-center justify-between px-4 py-3 hover:bg-emerald-700/30 transition-colors"
      onPress={onClick}
    >
      <View className="flex items-center">
        {icon}
        <Text className="ml-3">{label}</Text>
      </View>
      <MaterialIcons name="keyboard-arrow-right" size={24} color="#000000" />
    </TouchableOpacity>
  )
}
