"use client"

import { MaterialIcons } from "@expo/vector-icons"
import { Avatar, AvatarFallback, AvatarImage } from "components/ui/avatar"
import * as DocumentPicker from 'expo-document-picker'
import type React from "react"
import { useState } from "react"
import { ActivityIndicator, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native"
import { useAuthProfile } from '../hooks/useAuthProfile'
import { useNormalizedProfile } from '../hooks/useNormalizedProfile'
import { useUserProfile } from '../hooks/useUserProfile'
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
  initialAbout = "",
  initialPhone = "+998 90 943 32 00",
  initialAvatar = "/placeholder.svg?height=80&width=80",
  onSave,
}: EditProfileScreenProps) {
  const { profile: localProfile, updateProfile } = useUserProfile()
  const { profile: authProfile, updateProfile: updateAuthProfile } = useAuthProfile()
  const { profile: normalized } = useNormalizedProfile()
  const [name, setName] = useState(authProfile?.username || normalized?.name || localProfile?.displayName || initialName)
  const [about, setAbout] = useState(authProfile?.about || normalized?.bio || localProfile?.location || initialAbout)
  const [phone, setPhone] = useState(initialPhone)
  const [avatar, setAvatar] = useState(authProfile?.avatar || normalized?.avatar || localProfile?.avatar || initialAvatar)
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadMessage, setUploadMessage] = useState<string | null>(null)
  const [bio, setBio] = useState(authProfile?.about || normalized?.bio || localProfile?.location || "")
  const { balance } = useWallet()

  const validateName = (value: string) => {
    const trimmed = (value || '').trim()
    if (!trimmed) return 'Name cannot be empty'
    if (trimmed.length > 60) return 'Name is too long (max 60)'
    return null
  }

  const isSafeImageUri = (uri?: string | null) => {
    if (!uri) return true
    const u = uri.trim()
    if (!u) return true
    // Block javascript: URIs
    if (/^javascript:/i.test(u)) return false
    // Allow common RN-safe schemes and data images
    if (/^(https?:|file:|content:)/i.test(u)) return true
    if (/^data:image\//i.test(u)) return true
    // Allow internal placeholders without a scheme (no colon)
    if (!u.includes(':')) return true
    return false
  }

  const handleSave = () => {
    // Validation
    const nameError = validateName(name)
    if (nameError) {
      setUploadMessage(nameError)
      setTimeout(() => setUploadMessage(null), 2000)
      return
    }
    if (!isSafeImageUri(avatar)) {
      setUploadMessage('Invalid avatar URL')
      setTimeout(() => setUploadMessage(null), 2000)
      return
    }

    // Persist via profile service, mapping fields to canonical keys.
    // Use bio (wired) as the persisted about/location field.
    const updates = { 
      displayName: name.trim(), 
      location: (bio || about || '').trim(), 
      avatar: avatar?.trim() 
    }
    
    // Update local profile service
    updateProfile(updates)
      .then(async (res) => {
        if (!res.success) {
          setUploadMessage(res.error || 'Failed to save')
          setTimeout(() => setUploadMessage(null), 2500)
          return
        }
        
        // Also update Supabase profile via auth profile service
        await updateAuthProfile({
          about: (bio || about || '').trim(),
          avatar: avatar?.trim()
        })
        
        // Also notify parent legacy state if provided
        onSave({ name: name.trim(), about: (bio || about || '').trim(), phone, avatar })
        setUploadMessage('Profile updated')
        setTimeout(() => setUploadMessage(null), 1200)
        // Return to previous screen after a short delay
        setTimeout(() => onBack && onBack(), 300)
      })
      .catch((e) => {
        console.error('[EditProfile] save error', e)
        setUploadMessage('Error saving profile')
        setTimeout(() => setUploadMessage(null), 2500)
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
        
        // Validate file size (5MB limit)
        const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB in bytes
        if (selectedImage.size && selectedImage.size > MAX_FILE_SIZE) {
          setUploadMessage('Image too large. Maximum size is 5MB')
          setTimeout(() => setUploadMessage(null), 3000)
          return
        }
        
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
          setUploadMessage('Profile picture uploaded successfully!')
          setTimeout(() => setUploadMessage(null), 3000)
        } catch (uploadError) {
          console.error('Failed to upload avatar:', uploadError)
          setIsUploadingAvatar(false)
          // Still set the local URI so user can see their selection
          setAvatar(selectedImage.uri)
          setUploadMessage('Upload failed - using local image')
          setTimeout(() => setUploadMessage(null), 3000)
        }
      }
    } catch (error) {
      console.error('Error picking image:', error)
      setIsUploadingAvatar(false)
      setUploadMessage('Failed to select image')
      setTimeout(() => setUploadMessage(null), 3000)
    }
  }

  const handleBack = () => {
    // Save then navigate back
    handleSave()
  }

  return (
    <View className="flex-1 bg-emerald-600">
      {/* Upload Status Banner */}
      {uploadMessage && (
        <View style={{ position: 'absolute', top: 60, left: 16, right: 16, zIndex: 50 }}>
          <View className="bg-emerald-800 rounded-lg px-4 py-3 flex-row items-center justify-between shadow-lg">
            <Text className="text-white text-sm flex-1">{uploadMessage}</Text>
            <TouchableOpacity onPress={() => setUploadMessage(null)}>
              <MaterialIcons name="close" size={18} color="white" />
            </TouchableOpacity>
          </View>
        </View>
      )}
      {/* Header */}
      <View className="flex-row items-center justify-between p-4 pt-8 bg-emerald-700/80 border-b border-emerald-500/30">
        <View className="flex-row items-center">
          <MaterialIcons name="gps-fixed" size={24} color="#ffffff" />
          <Text className="text-white font-extrabold text-lg tracking-widest ml-2">BOUNTY</Text>
        </View>
        <TouchableOpacity onPress={handleBack} accessibilityLabel="Back" className="p-2">
          <MaterialIcons name="arrow-back" size={22} color="#ffffff" />
        </TouchableOpacity>
      </View>

      {/* Scrollable Content */}
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Screen Title */}
        <View className="px-4 py-3 bg-emerald-700/30 border-b border-emerald-500/20">
          <Text className="text-white text-xl font-semibold">Edit Profile</Text>
        </View>
        {/* Profile Picture */}
        <View className="px-4 py-6 bg-emerald-900/40 flex flex-col items-center">
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
          <Text className="text-xs text-center text-emerald-100/80 max-w-[220px]">
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
        <View className="px-4 py-4 bg-emerald-900/40 mt-1">
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Enter your name"
            className="w-full bg-transparent border-none p-0 text-white focus:outline-none focus:ring-0"
          />
        </View>

        {/* Phone Field - DEPRECATED: Phone number should be private and not displayed in UI
            TODO: Remove this field in next PR. Phone is managed in onboarding only. */}
        <View className="px-4 py-4 bg-emerald-900/30 mt-1" style={{ opacity: 0.5 }}>
          <Text className="text-xs text-emerald-300 mb-1">Phone (Private)</Text>
          <Text className="text-white text-sm">***-***-****</Text>
          <Text className="text-xs text-gray-400 mt-1">Phone is private and managed separately</Text>
        </View>

        {/* About Field */}
        <View className="px-4 py-4 bg-emerald-900/40 mt-1">
          <TextInput
            value={about}
            onChangeText={setAbout}
            placeholder="About"
            multiline
            className="w-full bg-transparent border-none p-0 text-white focus:outline-none focus:ring-0"
          />
        </View>

        {/* Additional Fields for Scrolling */}
        <View className="px-4 py-4 bg-emerald-900/40 mt-1">
          <Text className="text-xs text-emerald-300 block mb-1">Email</Text>
          <TextInput
            placeholder="your.email@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            className="w-full bg-transparent border-none p-0 text-white focus:outline-none focus:ring-0"
          />
        </View>

        <View className="px-4 py-4 bg-emerald-900/40 mt-1">
          <Text className="text-xs text-emerald-300 block mb-1">Location</Text>
          <TextInput
            placeholder="City, Country"
            className="w-full bg-transparent border-none p-0 text-white focus:outline-none focus:ring-0"
          />
        </View>

        <View className="px-4 py-4 bg-emerald-900/40 mt-1">
          <Text className="text-xs text-emerald-300 block mb-1">Website</Text>
          <TextInput
            placeholder="https://yourwebsite.com"
            keyboardType="url"
            autoCapitalize="none"
            className="w-full bg-transparent border-none p-0 text-white focus:outline-none focus:ring-0"
          />
        </View>

        <View className="px-4 py-4 bg-emerald-900/40 mt-1">
          <Text className="text-xs text-emerald-300 block mb-1">Birthday</Text>
          <TextInput
            placeholder="MM/DD/YYYY"
            className="w-full bg-transparent border-none p-0 text-white focus:outline-none focus:ring-0"
          />
        </View>

        <View className="px-4 py-4 bg-emerald-900/40 mt-1">
          <Text className="text-xs text-emerald-300 block mb-1">Languages</Text>
          <TextInput
            placeholder="English, Spanish, etc."
            className="w-full bg-transparent border-none p-0 text-white focus:outline-none focus:ring-0"
          />
        </View>

        <View className="px-4 py-6 bg-emerald-900/40 mt-1">
          <Text className="text-xs text-emerald-300 mb-2">Bio</Text>
          <TextInput
            placeholder="Tell us more about yourself..."
            multiline
            numberOfLines={4}
            value={bio}
            onChangeText={setBio}
            className="w-full bg-emerald-700/50 rounded-md p-3 text-white"
          />
        </View>

        {/* Privacy Section */}
        <View className="px-4 py-3 bg-emerald-700/30 mt-1">
          <Text className="text-lg font-medium">Privacy</Text>
        </View>

        <View className="px-4 py-4 bg-emerald-900/40 mt-1 flex items-center justify-between">
          <Text>Show phone number</Text>
          <View className="h-6 w-10 bg-emerald-700 rounded-full p-1 flex items-center">
            <View className="h-4 w-4 bg-white rounded-full"></View>
          </View>
        </View>

        <View className="px-4 py-4 bg-emerald-900/40 mt-1 flex items-center justify-between">
          <Text>Show profile photo</Text>
          <View className="h-6 w-10 bg-emerald-500 rounded-full p-1 flex justify-end items-center">
            <View className="h-4 w-4 bg-white rounded-full"></View>
          </View>
        </View>
      </ScrollView>
    </View>
  )
}
