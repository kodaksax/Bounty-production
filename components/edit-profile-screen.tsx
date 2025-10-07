"use client"

import { MaterialIcons } from "@expo/vector-icons"
import { Avatar, AvatarFallback, AvatarImage } from "components/ui/avatar"
import * as DocumentPicker from 'expo-document-picker'
import type React from "react"
import { useState } from "react"
import { Text, TextInput, TouchableOpacity, View, ActivityIndicator } from "react-native"
import { attachmentService } from '../lib/services/attachment-service'
import { useWallet } from '../lib/wallet-context'

interface EditProfileScreenProps {
  onBack: () => void
  initialName?: string
  initialAbout?: string
  initialPhone?: string  // DEPRECATED: Phone should not be passed or edited here
  initialAvatar?: string
  onSave: (data: { name: string; about: string; phone: string; avatar?: string }) => void
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
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const { balance } = useWallet()

  const handleSave = () => {
    onSave({
      name,
      about,
      phone,
      avatar,
    })
  }

  const handleAvatarClick = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'image/*',
        copyToCacheDirectory: true,
      })

      if (result.canceled) return

      if (result.assets && result.assets.length > 0) {
        const selectedImage = result.assets[0]
        
        // Set uploading state
        setIsUploadingAvatar(true)
        setUploadProgress(0)

        // Create attachment metadata
        const attachment = {
          id: `avatar-${Date.now()}`,
          name: selectedImage.name || 'avatar.jpg',
          uri: selectedImage.uri,
          mimeType: selectedImage.mimeType,
          size: selectedImage.size,
          status: 'uploading' as const,
          progress: 0,
        }

        try {
          // Upload using attachment service
          const uploaded = await attachmentService.upload(attachment, {
            onProgress: (progress) => {
              setUploadProgress(progress)
            },
          })

          // Update avatar with the uploaded URL
          setAvatar(uploaded.remoteUri || selectedImage.uri)
          setIsUploadingAvatar(false)
        } catch (uploadError) {
          console.error('Failed to upload avatar:', uploadError)
          setIsUploadingAvatar(false)
          // Still set the local URI so user can see their selection
          setAvatar(selectedImage.uri)
        }
      }
    } catch (error) {
      console.error('Error picking image:', error)
      setIsUploadingAvatar(false)
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
              <MaterialIcons name="gps-fixed" size={24} color="#000000" />
              <Text className="text-lg font-bold tracking-wider">BOUNTY</Text>
            </View>
            <Text className="text-lg font-bold">$ {balance.toFixed(2)}</Text>
          </View>
          <View className="h-px bg-emerald-500/50 my-2"></View>
        </View>

        {/* Settings Header */}
        <View className="px-4 py-2 flex items-center justify-between bg-emerald-700/30">
          <View className="flex items-center">
            <TouchableOpacity onPress={onBack} className="mr-2">
              <MaterialIcons name="arrow-back" size={24} color="#000000" />
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
            <TouchableOpacity
              style={{ position: 'absolute', bottom: 0, right: 0, height: 32, width: 32, borderRadius: 16, backgroundColor: '#10b981', alignItems: 'center', justifyContent: 'center' }}
              onPress={handleAvatarClick}
              disabled={isUploadingAvatar}
            >
              {isUploadingAvatar ? (
                <ActivityIndicator size="small" color="white" />
              ) : (
                <MaterialIcons name="camera-alt" size={16} color="white" />
              )}
            </TouchableOpacity>
          </View>
          <Text className="text-xs text-center text-gray-300 max-w-[200px]">
            {isUploadingAvatar 
              ? `Uploading... ${Math.round(uploadProgress * 100)}%`
              : "Enter your name and add an optional profile picture"}
          </Text>
          <TouchableOpacity 
            className="mt-2 text-emerald-300 text-sm"
            onPress={handleAvatarClick}
            disabled={isUploadingAvatar}
          >
            <Text className="text-emerald-300 text-sm">
              {isUploadingAvatar ? 'Uploading...' : 'Edit'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Name Field */}
        <View className="px-4 py-4 bg-gray-700/80 mt-1">
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Enter your name"
            className="w-full bg-transparent border-none p-0 text-white focus:outline-none focus:ring-0"
          />
        </View>

        {/* Phone Field - DEPRECATED: Phone number should be private and not displayed in UI
            TODO: Remove this field in next PR. Phone is managed in onboarding only. */}
        <View className="px-4 py-4 bg-gray-700/80 mt-1" style={{ opacity: 0.5 }}>
          <Text className="text-xs text-emerald-300 mb-1">Phone (Private)</Text>
          <Text className="text-white text-sm">***-***-****</Text>
          <Text className="text-xs text-gray-400 mt-1">Phone is private and managed separately</Text>
        </View>

        {/* About Field */}
        <View className="px-4 py-4 bg-gray-700/80 mt-1">
          <TextInput
            value={about}
            onChangeText={setAbout}
            placeholder="About"
            multiline
            className="w-full bg-transparent border-none p-0 text-white focus:outline-none focus:ring-0"
          />
        </View>

        {/* Additional Fields for Scrolling */}
        <View className="px-4 py-4 bg-gray-700/80 mt-1">
          <Text className="text-xs text-emerald-300 block mb-1">Email</Text>
          <TextInput
            placeholder="your.email@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            className="w-full bg-transparent border-none p-0 text-white focus:outline-none focus:ring-0"
          />
        </View>

        <View className="px-4 py-4 bg-gray-700/80 mt-1">
          <Text className="text-xs text-emerald-300 block mb-1">Location</Text>
          <TextInput
            placeholder="City, Country"
            className="w-full bg-transparent border-none p-0 text-white focus:outline-none focus:ring-0"
          />
        </View>

        <View className="px-4 py-4 bg-gray-700/80 mt-1">
          <Text className="text-xs text-emerald-300 block mb-1">Website</Text>
          <TextInput
            placeholder="https://yourwebsite.com"
            keyboardType="url"
            autoCapitalize="none"
            className="w-full bg-transparent border-none p-0 text-white focus:outline-none focus:ring-0"
          />
        </View>

        <View className="px-4 py-4 bg-gray-700/80 mt-1">
          <Text className="text-xs text-emerald-300 block mb-1">Birthday</Text>
          <TextInput
            placeholder="MM/DD/YYYY"
            className="w-full bg-transparent border-none p-0 text-white focus:outline-none focus:ring-0"
          />
        </View>

        <View className="px-4 py-4 bg-gray-700/80 mt-1">
          <Text className="text-xs text-emerald-300 block mb-1">Languages</Text>
          <TextInput
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
