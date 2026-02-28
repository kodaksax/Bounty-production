"use client"

import { MaterialIcons } from "@expo/vector-icons"
import AsyncStorage from '@react-native-async-storage/async-storage'
import { AvatarFallback } from "components/ui/avatar"
import { BrandingLogo } from "components/ui/branding-logo"
import * as ImagePicker from 'expo-image-picker'
import React, { useState } from "react"
import { ActionSheetIOS, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native"
import { usePortfolioUpload } from '../hooks/use-portfolio-upload'
import { useAuthProfile } from '../hooks/useAuthProfile'
import { useNormalizedProfile } from '../hooks/useNormalizedProfile'
import { usePortfolio } from '../hooks/usePortfolio'
import { useProfile } from '../hooks/useProfile'
import { useUserProfile } from '../hooks/useUserProfile'
import { OptimizedImage } from "../lib/components/OptimizedImage"
import { attachmentService } from '../lib/services/attachment-service'
import { processAvatarImage } from '../lib/utils/image-utils'
import { useWallet } from '../lib/wallet-context'
import { colors } from '../lib/theme'

interface EditProfileScreenProps {
  onBack: () => void
  initialName?: string
  initialAbout?: string
  initialPhone?: string  // DEPRECATED: Phone should not be passed or edited here
  initialAvatar?: string
  onSave: (data: { name: string; about: string; phone: string; avatar?: string }) => void
}

/**
 * @deprecated Legacy EditProfileScreen component - kept for backward compatibility
 * For the main edit profile flow, use app/profile/edit.tsx instead
 * This component is used by Settings screen but should route to the dedicated Edit Profile screen
 */
export function EditProfileScreen({
  onBack,
  initialName = "@jon_Doe",
  initialAbout = "",
  initialPhone = "+998 90 943 32 00",
  initialAvatar = "/placeholder.svg?height=80&width=80",
  onSave,
}: EditProfileScreenProps) {
  const { profile: localProfile, updateProfile, error: localProfileError } = useUserProfile()
  const { profile: authProfile, updateProfile: updateAuthProfile, loading: authLoading } = useAuthProfile()
  const { profile: normalized, loading: normalizedLoading, error: normalizedError, refresh: refreshNormalized } = useNormalizedProfile()
  const [name, setName] = useState(authProfile?.username || normalized?.name || localProfile?.displayName || initialName)
  const [title, setTitle] = useState(normalized?.title || "")
  const [location, setLocation] = useState((normalized as any)?.location || "")
  const [portfolio, setPortfolio] = useState((normalized as any)?.portfolio || "")
  const [bio, setBio] = useState(authProfile?.about || normalized?.bio || localProfile?.location || "")
  const [avatar, setAvatar] = useState(authProfile?.avatar || normalized?.avatar || localProfile?.avatar || initialAvatar)
  const [pendingAvatarRemoteUri, setPendingAvatarRemoteUri] = useState<string | undefined>(undefined)
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadMessage, setUploadMessage] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const { balance } = useWallet()
  const { profile: currentProfile, updateProfile: updateUserProfile } = useProfile()
  const userIdForPortfolio = authProfile?.id || 'current-user'
  const { addItem: addPortfolioItem } = usePortfolio(userIdForPortfolio)
  const { pickAndUpload: pickPortfolioItem, isUploading: isUploadingPortfolio, progress: portfolioProgress } = usePortfolioUpload({
    userId: userIdForPortfolio,
    onUploaded: async (item) => {
      await addPortfolioItem({ ...item, id: undefined as any, createdAt: undefined as any } as any)
    },
  })

  // Draft persistence keys - MUST be user-specific to prevent data leaks
  const userId = authProfile?.id || 'anon';
  const DRAFT_KEY = `editProfile:draft:${userId}`;

  // Track whether form has been modified
  const [hasChanges, setHasChanges] = React.useState(false);

  // Track initial values to compare against
  const [initialValues, setInitialValues] = React.useState({
    name: '',
    title: '',
    location: '',
    portfolio: '',
    bio: '',
    avatar: '',
  });

  // Reset form data when userId changes to prevent data leaks between users
  React.useEffect(() => {
    // Clear form state to prevent showing previous user's data
    const newName = authProfile?.username || normalized?.name || localProfile?.displayName || initialName;
    const newTitle = normalized?.title || "";
    const newLocation = normalized?.location || "";
    const newPortfolio = normalized?.portfolio || "";
    const newBio = authProfile?.about || normalized?.bio || localProfile?.location || "";
    const newAvatar = authProfile?.avatar || normalized?.avatar || localProfile?.avatar || initialAvatar;

    setName(newName);
    setTitle(newTitle);
    setLocation(newLocation);
    setPortfolio(newPortfolio);
    setBio(newBio);
    setAvatar(newAvatar);
    setPendingAvatarRemoteUri(undefined);
    setHasChanges(false);

    // Update initial values
    setInitialValues({
      name: newName,
      title: newTitle,
      location: newLocation,
      portfolio: newPortfolio,
      bio: newBio,
      avatar: newAvatar,
    });
  }, [userId]); // Reset when userId changes

  // Check if any field has changed from initial values
  React.useEffect(() => {
    const changed =
      name !== initialValues.name ||
      title !== initialValues.title ||
      location !== initialValues.location ||
      portfolio !== initialValues.portfolio ||
      bio !== initialValues.bio ||
      avatar !== initialValues.avatar;
    setHasChanges(changed);
  }, [name, title, location, portfolio, bio, avatar, initialValues]);

  // Hydrate draft on mount (only if userId hasn't changed)
  React.useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(DRAFT_KEY);
        if (raw) {
          const draft = JSON.parse(raw);
          if (draft.name) setName(draft.name);
          if (draft.title) setTitle(draft.title);
          if (draft.location) setLocation(draft.location);
          if (draft.portfolio) setPortfolio(draft.portfolio);
          if (draft.bio) setBio(draft.bio);
          if (draft.avatar) setAvatar(draft.avatar);
        }
      } catch { }
    })();
  }, [DRAFT_KEY]);

  // Persist draft on changes (debounced)
  React.useEffect(() => {
    const t = setTimeout(() => {
      const payload = { name, title, location, portfolio, bio, avatar };
      AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(payload)).catch(() => { });
    }, 250);
    return () => clearTimeout(t);
  }, [name, title, location, portfolio, bio, avatar, DRAFT_KEY]);

  // Show loading state if profiles are still loading
  const isLoading = authLoading || normalizedLoading

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

  const handleSave = async () => {
    // Prevent multiple simultaneous saves
    if (isSaving) return

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

    setIsSaving(true)

    try {
      // OPTIMIZATION: Parallelize profile updates for faster save
      // Update primary auth profile first, then run other updates concurrently
      const updatedProfile = await updateAuthProfile({
        username: name.trim(),
        about: (bio || '').trim(),
        avatar: (pendingAvatarRemoteUri || avatar)?.trim()
      })

      if (!updatedProfile) {
        setUploadMessage('Failed to save profile. Please try again.')
        setTimeout(() => setUploadMessage(null), 2500)
        setIsSaving(false)
        return
      }

      // OPTIMIZATION: Run secondary updates and cleanup concurrently
      // These are non-critical and can happen in parallel
      const updates = {
        displayName: name.trim(),
        avatar: (pendingAvatarRemoteUri || avatar)?.trim(),
        location: location.trim() || undefined,
      } as any

      const userProfileUpdate = {
        name: name.trim(),
        title: title.trim() || undefined,
        location: location.trim() || undefined,
        portfolio: portfolio.trim() || undefined,
        bio: (bio || '').trim(),
        avatar: (pendingAvatarRemoteUri || avatar)?.trim() || undefined,
      }

      // Execute all secondary operations in parallel and log any failures
      const secondaryOperations = [
        { name: 'updateProfile', promise: updateProfile(updates) },
        { name: 'updateUserProfile', promise: updateUserProfile(userProfileUpdate) },
        { name: 'refreshNormalized', promise: refreshNormalized?.() || Promise.resolve() },
        { name: 'clearDraft', promise: AsyncStorage.removeItem(DRAFT_KEY) },
      ]

      const secondaryResults = await Promise.allSettled(
        secondaryOperations.map((op) => op.promise)
      )

      secondaryResults.forEach((result, index) => {
        if (result.status === 'rejected') {
          const opName = secondaryOperations[index]?.name ?? `operation_${index}`
          console.error(
            '[EditProfileScreen] Secondary profile update failed',
            { operation: opName, reason: result.reason }
          )
        }
      })

      // Notify parent legacy state if provided
      onSave({ name: name.trim(), about: (bio || '').trim(), phone: '', avatar })

      setUploadMessage('✓ Profile updated successfully!')
      setTimeout(() => setUploadMessage(null), 1200)

      // Return to previous screen after a short delay
      setTimeout(() => {
        setIsSaving(false)
        if (onBack) onBack()
      }, 300)
    } catch (e) {
      console.error('[EditProfile] save error', e)
      setUploadMessage('Error saving profile. Please try again.')
      setTimeout(() => setUploadMessage(null), 2500)
      setIsSaving(false)
    }
  }

  const handleAvatarClick = async () => {
    try {
      const showPicker = async () => {
        return new Promise<'camera' | 'library' | null>((resolve) => {
          const options = ['Take Photo', 'Choose from Library', 'Cancel'];
          if (Platform.OS === 'ios') {
            ActionSheetIOS.showActionSheetWithOptions(
              {
                options,
                cancelButtonIndex: 2,
              },
              (buttonIndex: number) => {
                if (buttonIndex === 0) resolve('camera');
                else if (buttonIndex === 1) resolve('library');
                else resolve(null);
              }
            );
          } else {
            Alert.alert(
              'Select Photo',
              'Choose a source',
              [
                { text: 'Take Photo', onPress: () => resolve('camera') },
                { text: 'Choose from Library', onPress: () => resolve('library') },
                { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
              ],
              { cancelable: true, onDismiss: () => resolve(null) }
            );
          }
        });
      };

      const source = await showPicker();
      if (!source) return;

      let result: ImagePicker.ImagePickerResult;

      if (source === 'camera') {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') {
          setUploadMessage('Permission to access camera is required');
          setTimeout(() => setUploadMessage(null), 3000);
          return;
        }
        result = await ImagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          allowsEditing: true,
          aspect: [1, 1],
          quality: 0.9,
        });
      } else {
        // Request permission
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
          setUploadMessage('Permission to access photos is required');
          setTimeout(() => setUploadMessage(null), 3000);
          return;
        }

        // Launch image library with square aspect ratio for avatar cropping
        result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          allowsEditing: true,
          aspect: [1, 1],
          quality: 0.9,
          exif: false,
        });
      }

      if (result.canceled) return;

      const selected = result.assets?.[0];
      if (!selected) return;

      // Validate file size (5MB limit) - many pickers don't provide size, so guard if available
      const MAX_FILE_SIZE = 5 * 1024 * 1024;
      if ((selected as any).fileSize && (selected as any).fileSize > MAX_FILE_SIZE) {
        setUploadMessage('Image too large. Maximum size is 5MB');
        setTimeout(() => setUploadMessage(null), 3000);
        return;
      }

      setIsUploadingAvatar(true);
      setUploadProgress(0);
      setUploadMessage('Processing image…');

      // OPTIMIZATION: Process the avatar image with optimized pipeline
      // The new processAvatarImage combines crop+resize+compression into fewer operations
      let processedUri = selected.uri;
      try {
        setUploadProgress(0.05);
        const processed = await processAvatarImage(selected.uri, 400);
        processedUri = processed.uri;
        setUploadProgress(0.4); // Processing faster now, takes less progress bar space
        setUploadMessage('Uploading…');
      } catch (processError) {
        console.error('Avatar processing failed, using original:', processError);
        setUploadMessage('Processing failed, uploading original…');
      }

      const attachment = {
        id: `avatar-${Date.now()}`,
        name: selected.fileName || 'avatar.jpg',
        uri: processedUri,
        mimeType: 'image/jpeg',
        size: (selected as any).fileSize,
        status: 'uploading' as const,
        progress: 0,
      };

      try {
        const uploaded = await attachmentService.upload(attachment, {
          onProgress: (p) => setUploadProgress(0.4 + p * 0.6),
        });
        // Use processed URI for immediate preview; store remote for persistence
        setAvatar(processedUri);
        setPendingAvatarRemoteUri(uploaded.remoteUri);
        setIsUploadingAvatar(false);
        setUploadMessage('✓ Profile picture uploaded!');
        setTimeout(() => setUploadMessage(null), 2500);
      } catch (uploadError) {
        console.error('Failed to upload avatar:', uploadError);
        setIsUploadingAvatar(false);
        setAvatar(processedUri);
        setPendingAvatarRemoteUri(undefined);

        // Provide more specific error message based on error type
        const errorMessage = uploadError instanceof Error ? uploadError.message : 'Upload failed';
        if (errorMessage.includes('timeout')) {
          setUploadMessage('Upload timeout - check your connection and try again');
        } else if (errorMessage.includes('network') || errorMessage.includes('fetch')) {
          setUploadMessage('Network error - using local image for now');
        } else {
          setUploadMessage('Upload failed - using local image');
        }
        setTimeout(() => setUploadMessage(null), 4000);
      }
    } catch (error) {
      console.error('Error picking image:', error);
      setIsUploadingAvatar(false);
      setUploadMessage('Failed to select image');
      setTimeout(() => setUploadMessage(null), 3000);
    }
  }

  const handleBack = () => {
    // Check if user has unsaved changes
    if (hasChanges) {
      // Show warning dialog
      Alert.alert(
        'Unsaved Changes',
        'You have unsaved changes. Are you sure you want to leave without saving?',
        [
          {
            text: 'Keep Editing',
            style: 'cancel',
          },
          {
            text: 'Discard Changes',
            style: 'destructive',
            onPress: () => {
              // Reset form to initial values
              setName(initialValues.name);
              setTitle(initialValues.title);
              setLocation(initialValues.location);
              setPortfolio(initialValues.portfolio);
              setBio(initialValues.bio);
              setAvatar(initialValues.avatar);
              setPendingAvatarRemoteUri(undefined);
              setHasChanges(false);

              // Navigate back
              if (onBack) onBack();
            },
          },
        ]
      );
    } else {
      // No changes, navigate back immediately
      if (onBack) onBack();
    }
  }

  // Show loading spinner if profiles are loading
  if (isLoading) {
    return (
      <View className="flex-1 bg-emerald-600 items-center justify-center">
        <ActivityIndicator size="large" color={colors.primary[500]} />
        <Text className="text-white text-sm mt-4">Loading profile...</Text>
      </View>
    )
  }

  // Show error state if there's an error loading profiles
  if (localProfileError || normalizedError) {
    return (
      <View className="flex-1 bg-emerald-600">
        <View className="flex-row items-center justify-between p-4 pt-8 bg-emerald-700/80 border-b border-emerald-500/30">
          <View className="flex-row items-center">
            <BrandingLogo size="small" />
          </View>
          <TouchableOpacity onPress={onBack} accessibilityLabel="Back" className="p-2">
            <MaterialIcons name="arrow-back" size={22} color="#ffffff" />
          </TouchableOpacity>
        </View>
        <View className="flex-1 items-center justify-center px-6">
          <MaterialIcons name="error-outline" size={48} color="#ef4444" />
          <Text className="text-white text-lg font-semibold mt-4 text-center">Failed to Load Profile</Text>
          <Text className="text-emerald-200 text-sm mt-2 text-center">
            {localProfileError || normalizedError}
          </Text>
          <TouchableOpacity
            onPress={onBack}
            className="mt-6 px-6 py-3 bg-emerald-700 rounded-lg"
          >
            <Text className="text-white font-semibold">Go Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    )
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
      {/* Header - Twitter-like modal style */}
      <View className="flex-row items-center justify-between p-4 pt-8 bg-emerald-700/80 border-b border-emerald-500/30">
        <TouchableOpacity onPress={handleBack} accessibilityLabel="Close" className="p-2" disabled={isSaving}>
          <MaterialIcons name="close" size={22} color="#ffffff" />
        </TouchableOpacity>
        <Text className="text-white font-extrabold text-base tracking-widest">Edit Profile</Text>
        <TouchableOpacity
          onPress={handleSave}
          disabled={isSaving}
          className={`px-4 py-2 bg-white rounded-full ${isSaving ? 'opacity-60' : ''}`}
          accessibilityLabel="Update Profile"
        >
          {isSaving ? (
            <ActivityIndicator size="small" color={colors.primary[600]} />
          ) : (
            <Text className="text-emerald-700 font-extrabold">Update Profile</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Scrollable Content with KeyboardAvoidingView */}
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
        keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0}
      >
        <ScrollView
          contentContainerStyle={{ paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Banner area (Twitter-like aesthetic placeholder) */}
          <View className="h-24 bg-emerald-800/40" />

          {/* Avatar */}
          <View className="px-4 -mt-8 flex flex-col items-start">
            <View className="relative mb-2">
              <View className="h-20 w-20 rounded-full overflow-hidden border-2 border-emerald-500 bg-emerald-800 items-center justify-center">
                {avatar ? (
                  <OptimizedImage
                    source={{ uri: avatar }}
                    width={80}
                    height={80}
                    style={{ width: 80, height: 80, borderRadius: 40 }}
                    resizeMode="cover"
                    useThumbnail
                    priority="low"
                    alt="Profile"
                  />
                ) : (
                  <AvatarFallback className="bg-emerald-800 text-emerald-200">
                    {initialName.substring(0, 2).toUpperCase()}
                  </AvatarFallback>
                )}
              </View>
              <TouchableOpacity
                style={{ position: 'absolute', bottom: 0, right: 0, height: 32, width: 32, borderRadius: 16, backgroundColor: colors.primary[500], alignItems: 'center', justifyContent: 'center' }}
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
            {isUploadingAvatar ? (
              <Text className="text-xs text-emerald-100/80">Uploading... {Math.round(uploadProgress * 100)}%</Text>
            ) : null}
          </View>

          {/* Fields - Twitter style inputs */}
          <View className="px-4 py-3 bg-emerald-900/30 mt-1">
            <Text className="text-xs text-emerald-300 mb-1">Name</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Your name"
              className="w-full bg-transparent border-b border-emerald-600 pb-2 text-white"
            />
          </View>

          <View className="px-4 py-3 bg-emerald-900/30 mt-1">
            <Text className="text-xs text-emerald-300 mb-1">Title</Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="e.g., Full Stack Developer"
              className="w-full bg-transparent border-b border-emerald-600 pb-2 text-white"
            />
          </View>

          <View className="px-4 py-3 bg-emerald-900/30 mt-1">
            <Text className="text-xs text-emerald-300 mb-1">Location</Text>
            <TextInput
              value={location}
              onChangeText={setLocation}
              placeholder="City, Country"
              className="w-full bg-transparent border-b border-emerald-600 pb-2 text-white"
            />
          </View>

          <View className="px-4 py-3 bg-emerald-900/30 mt-1">
            <Text className="text-xs text-emerald-300 mb-1">Portfolio</Text>
            <TextInput
              value={portfolio}
              onChangeText={setPortfolio}
              placeholder="https://yourportfolio.com"
              keyboardType="url"
              autoCapitalize="none"
              className="w-full bg-transparent border-b border-emerald-600 pb-2 text-white"
            />
            <View className="flex-row items-center mt-3">
              <TouchableOpacity
                onPress={pickPortfolioItem}
                className="bg-emerald-600 rounded-lg px-3 py-2"
                disabled={isUploadingPortfolio}
              >
                <Text className="text-white text-sm">
                  {isUploadingPortfolio ? `Uploading ${Math.round((portfolioProgress || 0) * 100)}%` : 'Add Portfolio Item'}
                </Text>
              </TouchableOpacity>
              <Text className="text-xs text-emerald-200 ml-3">Upload images, videos, or files</Text>
            </View>
          </View>

          <View className="px-4 py-3 bg-emerald-900/30 mt-1">
            <Text className="text-xs text-emerald-300 mb-1">Bio</Text>
            <TextInput
              placeholder="Tell us about yourself"
              multiline
              numberOfLines={4}
              value={bio}
              onChangeText={setBio}
              className="w-full bg-emerald-800/40 rounded-md p-3 text-white"
            />
          </View>
          {/* Footer space */}
          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  )
}
