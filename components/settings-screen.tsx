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
    <div className="flex flex-col min-h-screen bg-emerald-600 text-white">
      {/* Header */}
      <div className="flex justify-between items-center p-4 pt-8">
        <div className="flex items-center">
          <Target className="h-5 w-5 mr-2" />
          <span className="text-lg font-bold tracking-wider">BOUNTY</span>
        </div>
        <span className="text-lg font-bold">$ 40.00</span>
      </div>

      {/* Back button and title */}
      <div className="px-4 py-2 flex items-center">
        <button onClick={onBack} className="mr-2">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-xl font-medium">Settings</h1>
      </div>

      {/* Profile section */}
      <div className="px-4 py-3 bg-emerald-700/30">
        <div className="flex items-center justify-between" onClick={() => setShowEditProfile(true)}>
          <div className="flex items-center">
            <Avatar className="h-12 w-12 mr-3 border-2 border-white">
              <AvatarImage src={profileData.avatar} alt={profileData.name} />
              <AvatarFallback>JD</AvatarFallback>
            </Avatar>
            <div>
              <h2 className="font-medium">{profileData.name}</h2>
              <p className="text-xs text-emerald-200">{profileData.about}</p>
            </div>
          </div>
          <ChevronRight className="h-5 w-5 text-emerald-300" />
        </div>
      </div>

      {/* Settings options */}
      <div className="flex-1">
        <div className="py-2">
          <SettingsItem icon={<Star className="h-5 w-5 text-yellow-400" />} label="Starred Messages" />
          <SettingsItem icon={<Laptop className="h-5 w-5 text-teal-400" />} label="WhatsApp Web/Desktop" />
          <SettingsItem icon={<User className="h-5 w-5 text-blue-400" />} label="Account" />
          <SettingsItem icon={<MessageSquare className="h-5 w-5 text-green-400" />} label="Chats" />
          <SettingsItem icon={<Bell className="h-5 w-5 text-red-400" />} label="Notifications" />
          <SettingsItem icon={<Database className="h-5 w-5 text-purple-400" />} label="Data and Storage Usage" />
          <SettingsItem icon={<HelpCircle className="h-5 w-5 text-blue-400" />} label="Help" />
          <SettingsItem icon={<Heart className="h-5 w-5 text-red-400" />} label="Tell a Friend" />
        </div>
      </div>

      {/* Bottom Navigation Indicator */}
      <div className="mt-auto flex justify-center pb-6">
        <div className="h-1 w-1 rounded-full bg-white/50 mx-1"></div>
        <div className="h-1 w-1 rounded-full bg-white/50 mx-1"></div>
        <div className="h-1 w-1 rounded-full bg-white/50 mx-1"></div>
        <div className="h-1 w-1 rounded-full bg-white/50 mx-1"></div>
        <div className="h-1 w-1 rounded-full bg-white/50 mx-1"></div>
      </div>
    </div>
  )
}

interface SettingsItemProps {
  icon: React.ReactNode
  label: string
  onClick?: () => void
}

function SettingsItem({ icon, label, onClick }: SettingsItemProps) {
  return (
    <button
      className="w-full flex items-center justify-between px-4 py-3 hover:bg-emerald-700/30 transition-colors"
      onClick={onClick}
    >
      <div className="flex items-center">
        {icon}
        <span className="ml-3">{label}</span>
      </div>
      <ChevronRight className="h-5 w-5 text-emerald-300" />
    </button>
  )
}
