"use client"

import type React from "react"
import { View, Text, TouchableOpacity, TextInput } from "react-native"

import { useState, useRef } from "react"
import { View, Text, TouchableOpacity, TextInput } from "react-native"
import { ArrowLeft, Target, Camera } from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "components/ui/avatar"

interface EditProfileScreenProps {
  onBack: () => void
  initialName?: string
  initialAbout?: string
  initialPhone?: string
  initialAvatar?: string
  onSave: (data: { name: string; about: string; phone: string }) => void
}

export function EditProfileScreen({
  onBack,
  initialName = "@jon_Doe",
  initialAbout = "Russian opportunist",
  initialPhone = "+998 90 943 32 00",
  initialAvatar = "/placeholder.svg?height=80&width=80",
  onSave,
}: EditProfileScreenProps) {
  const [name, setName] = useState(initialName)
  const [about, setAbout] = useState(initialAbout)
  const [phone, setPhone] = useState(initialPhone)
  const [avatar, setAvatar] = useState(initialAvatar)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleSave = () => {
    onSave({
      name,
      about,
      phone,
    })
  }

  const handleAvatarClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      // In a real app, you would upload the file to a server
      // For now, we'll just create a local URL
      const url = URL.createObjectURL(file)
      setAvatar(url)
    }
  }

  return (
    <View className="flex flex-col min-h-screen bg-emerald-600 text-white">
      {/* Fixed Header */}
      <View className="sticky top-0 z-10 bg-emerald-600">
        {/* Header */}
        <View className="p-4 pt-8 pb-2">
          <View className="flex justify-between items-center">
            <View className="flex items-center">
              <Target className="h-5 w-5 mr-2" />
              <Text className="text-lg font-bold tracking-wider">BOUNTY</Text>
            </View>
            <Text className="text-lg font-bold">$ 40.00</Text>
          </View>
          <View className="h-px bg-emerald-500/50 my-2"></View>
        </View>

        {/* Settings Header */}
        <View className="px-4 py-2 flex items-center justify-between bg-emerald-700/30">
          <View className="flex items-center">
            <TouchableOpacity onPress={onBack} className="mr-2">
              <ArrowLeft className="h-5 w-5" />
            </TouchableOpacity>
            <Text className="text-lg">Settings</Text>
          </View>
          <TouchableOpacity className="text-sm font-medium bg-emerald-700/50 px-3 py-1 rounded-md" onPress={handleSave}>
            Save
          </TouchableOpacity>
        </View>

        {/* Edit Profile Title */}
        <View className="px-4 py-3 bg-emerald-700/30">
          <Text className="text-xl font-bold">Edit Profile</Text>
        </View>
      </View>

      {/* Scrollable Content */}
      <View className="flex-1 overflow-y-auto pb-20">
        {/* Profile Picture */}
        <View className="px-4 py-6 bg-gray-700/80 flex flex-col items-center">
          <View className="relative mb-2">
            <Avatar className="h-20 w-20 border-2 border-emerald-500">
              <AvatarImage src={avatar} alt="Profile" />
              <AvatarFallback className="bg-emerald-800 text-emerald-200">
                {initialName.substring(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <button
              className="absolute bottom-0 right-0 h-8 w-8 rounded-full bg-emerald-500 flex items-center justify-center"
              onPress={handleAvatarClick}
            >
              <Camera className="h-4 w-4 text-white" />
            </TouchableOpacity>
            <TextInput type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileChange} / />
          </View>
          <Text className="text-xs text-center text-gray-300 max-w-[200px]">
            Enter your name and add an optional profile picture
          </Text>
          <TouchableOpacity className="mt-2 text-emerald-300 text-sm">Edit</TouchableOpacity>
        </View>

        {/* Name Field */}
        <View className="px-4 py-4 bg-gray-700/80 mt-1">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full bg-transparent border-none p-0 text-white focus:outline-none focus:ring-0"
          />
        </View>

        {/* Phone Field */}
        <View className="px-4 py-4 bg-gray-700/80 mt-1">
          <input
            type="text"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full bg-transparent border-none p-0 text-white focus:outline-none focus:ring-0"
          />
        </View>

        {/* About Field */}
        <View className="px-4 py-4 bg-gray-700/80 mt-1">
          <input
            type="text"
            value={about}
            onChange={(e) => setAbout(e.target.value)}
            placeholder="About"
            className="w-full bg-transparent border-none p-0 text-white focus:outline-none focus:ring-0"
          />
        </View>

        {/* Additional Fields for Scrolling */}
        <View className="px-4 py-4 bg-gray-700/80 mt-1">
          <label className="text-xs text-emerald-300 block mb-1">Email</label>
          <input
            type="email"
            placeholder="your.email@example.com"
            className="w-full bg-transparent border-none p-0 text-white focus:outline-none focus:ring-0"
          />
        </View>

        <View className="px-4 py-4 bg-gray-700/80 mt-1">
          <label className="text-xs text-emerald-300 block mb-1">Location</label>
          <input
            type="text"
            placeholder="City, Country"
            className="w-full bg-transparent border-none p-0 text-white focus:outline-none focus:ring-0"
          />
        </View>

        <View className="px-4 py-4 bg-gray-700/80 mt-1">
          <label className="text-xs text-emerald-300 block mb-1">Website</label>
          <input
            type="url"
            placeholder="https://yourwebsite.com"
            className="w-full bg-transparent border-none p-0 text-white focus:outline-none focus:ring-0"
          />
        </View>

        <View className="px-4 py-4 bg-gray-700/80 mt-1">
          <label className="text-xs text-emerald-300 block mb-1">Birthday</label>
          <input
            type="text"
            placeholder="MM/DD/YYYY"
            className="w-full bg-transparent border-none p-0 text-white focus:outline-none focus:ring-0"
          />
        </View>

        <View className="px-4 py-4 bg-gray-700/80 mt-1">
          <label className="text-xs text-emerald-300 block mb-1">Languages</label>
          <input
            type="text"
            placeholder="English, Spanish, etc."
            className="w-full bg-transparent border-none p-0 text-white focus:outline-none focus:ring-0"
          />
        </View>

        <View className="px-4 py-6 bg-gray-700/80 mt-1">
          <label className="text-xs text-emerald-300 block mb-2">Bio</label>
          <textarea
            placeholder="Tell us more about yourself..."
            rows={4}
            className="w-full bg-emerald-700/50 border-none rounded-md p-3 text-white focus:outline-none focus:ring-1 focus:ring-emerald-400 resize-none"
          ></textarea>
        </View>

        {/* Privacy Section */}
        <View className="px-4 py-3 bg-emerald-700/30 mt-1">
          <Text className="text-lg font-medium">Privacy</Text>
        </View>

        <View className="px-4 py-4 bg-gray-700/80 mt-1 flex items-center justify-between">
          <Text>Show phone number</Text>
          <View className="h-6 w-10 bg-emerald-700 rounded-full p-1 flex items-center">
            <View className="h-4 w-4 bg-white rounded-full"></View>
          </View>
        </View>

        <View className="px-4 py-4 bg-gray-700/80 mt-1 flex items-center justify-between">
          <Text>Show profile photo</Text>
          <View className="h-6 w-10 bg-emerald-500 rounded-full p-1 flex justify-end items-center">
            <View className="h-4 w-4 bg-white rounded-full"></View>
          </View>
        </View>
      </View>
    </View>
  )
}
