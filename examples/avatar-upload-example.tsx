/**
 * Avatar Upload Example
 * 
 * This file demonstrates how to use the avatar upload feature in different ways.
 * Copy and adapt these examples to your components.
 */

import { MaterialIcons } from "@expo/vector-icons"
import { useState } from "react"
import { View, Text, TouchableOpacity, ActivityIndicator, Image } from "react-native"
import { useAvatarUpload } from "../hooks/use-avatar-upload"
import { avatarService } from "../lib/services/avatar-service"

// ============================================================================
// Example 1: Using the custom hook (Recommended for most cases)
// ============================================================================
export function AvatarUploadExample1() {
  const {
    isUploading,
    progress,
    avatarUrl,
    message,
    pickAndUploadAvatar,
    clearMessage,
  } = useAvatarUpload({
    profileId: 'example-user-123',
    onSuccess: (url) => {
      console.log('✅ Avatar uploaded successfully:', url)
    },
    onError: (error) => {
      console.error('❌ Upload failed:', error.message)
    },
  })

  return (
    <View style={{ padding: 20 }}>
      <Text style={{ fontSize: 18, fontWeight: 'bold', marginBottom: 10 }}>
        Example 1: Using Custom Hook
      </Text>

      {/* Avatar Preview */}
      <View style={{ alignItems: 'center', marginBottom: 20 }}>
        {avatarUrl ? (
          <Image
            source={{ uri: avatarUrl }}
            style={{ width: 100, height: 100, borderRadius: 50 }}
          />
        ) : (
          <View
            style={{
              width: 100,
              height: 100,
              borderRadius: 50,
              backgroundColor: '#10b981',
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            <Text style={{ color: 'white', fontSize: 24 }}>?</Text>
          </View>
        )}

        {/* Upload Button */}
        <TouchableOpacity
          style={{
            marginTop: 10,
            paddingHorizontal: 20,
            paddingVertical: 10,
            backgroundColor: isUploading ? '#6b7280' : '#10b981',
            borderRadius: 8,
          }}
          onPress={pickAndUploadAvatar}
          disabled={isUploading}
        >
          {isUploading ? (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <ActivityIndicator size="small" color="white" />
              <Text style={{ color: 'white', marginLeft: 8 }}>
                Uploading... {Math.round(progress * 100)}%
              </Text>
            </View>
          ) : (
            <Text style={{ color: 'white' }}>Upload Avatar</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Status Message */}
      {message && (
        <View
          style={{
            padding: 12,
            backgroundColor: '#10b981',
            borderRadius: 8,
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <Text style={{ color: 'white', flex: 1 }}>{message}</Text>
          <TouchableOpacity onPress={clearMessage}>
            <MaterialIcons name="close" size={20} color="white" />
          </TouchableOpacity>
        </View>
      )}
    </View>
  )
}

// ============================================================================
// Example 2: Minimal implementation (Quick integration)
// ============================================================================
export function AvatarUploadExample2() {
  const { pickAndUploadAvatar, isUploading, progress } = useAvatarUpload()

  return (
    <View style={{ padding: 20 }}>
      <Text style={{ fontSize: 18, fontWeight: 'bold', marginBottom: 10 }}>
        Example 2: Minimal Implementation
      </Text>

      <TouchableOpacity
        style={{
          padding: 12,
          backgroundColor: '#10b981',
          borderRadius: 8,
        }}
        onPress={pickAndUploadAvatar}
        disabled={isUploading}
      >
        <Text style={{ color: 'white', textAlign: 'center' }}>
          {isUploading
            ? `Uploading ${Math.round(progress * 100)}%`
            : 'Upload Avatar'}
        </Text>
      </TouchableOpacity>
    </View>
  )
}

export default {
  Example1: AvatarUploadExample1,
  Example2: AvatarUploadExample2,
}
