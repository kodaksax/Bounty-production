"use client"
import { MaterialIcons } from "@expo/vector-icons";
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AchievementsGrid } from "components/achievements-grid";
import { EnhancedProfileSection, PortfolioSection } from "components/enhanced-profile-section";
import { HistoryScreen } from "components/history-screen";
import { SkillsetChips } from "components/skillset-chips";
import { bountyRequestService } from "lib/services/bounty-request-service";
import { bountyService } from "lib/services/bounty-service";
// Remove static CURRENT_USER_ID usage; we'll derive from authenticated session
// import { CURRENT_USER_ID } from "lib/utils/data-utils";
import { useFocusEffect } from "expo-router";
import * as React from "react";
import { useEffect, useState } from "react";
import { ScrollView, Share, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SettingsScreen } from "../../components/settings-screen";
import { SkillsetEditScreen } from "../../components/skillset-edit-screen";
import { useAuthContext } from '../../hooks/use-auth-context';
import { useAuthProfile } from "../../hooks/useAuthProfile";
import { useNormalizedProfile } from "../../hooks/useNormalizedProfile";

// Update the ProfileScreen component to include real-time statistics
export function ProfileScreen({ onBack }: { onBack?: () => void } = {}) {
  const [isEditing, setIsEditing] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [updateMessage, setUpdateMessage] = useState<string | null>(null)
  const [profileData, setProfileData] = useState({
    name: "",
    about: "",
    avatar: "/placeholder.svg?height=80&width=80",
  })
  const [skills, setSkills] = useState<{ id: string; icon: string; text: string; credentialUrl?: string }[]>([])
  
  // Auth session (Supabase) provides canonical user id
  const { session } = useAuthContext();
  const authUserId = session?.user?.id;
  // Use new profile service (abstracted user profile fields)
  const { profile: userProfile, refresh: refreshUserProfile } = useNormalizedProfile()
  // Also use auth profile service for Supabase-synced profile
  const { profile: authProfile, refreshProfile: refreshAuthProfile } = useAuthProfile()

  // Add state for statistics
  const [stats, setStats] = useState({
    jobsAccepted: 0,
    bountiesPosted: 0,
    badgesEarned: 0,
    isLoading: true,
  })

  // Activity feed removed per requirements

  // readiness flag to avoid rendering EnhancedProfileSection with an empty id
  const profileUuid = authProfile?.id || authUserId
  const isProfileReady = !!profileUuid
  // Determine if viewing own profile (then let EnhancedProfileSection load current-user)
  const isOwnProfile = !!(authUserId && profileUuid && profileUuid === authUserId)

  // Fetch initial statistics from Supabase, responding to auth user changes
  useEffect(() => {
    const fetchStats = async () => {
      if (!authUserId) return;
      try {
        const postedBounties = await bountyService.getByUserId(authUserId);
        const acceptedRequests = await bountyRequestService.getByUserId(authUserId);
        const acceptedJobs = acceptedRequests.filter((req) => req.status === 'accepted');
        const badgesCount = Math.min(postedBounties.length, 3);
        setStats({
          jobsAccepted: acceptedJobs.length,
          bountiesPosted: postedBounties.length,
          badgesEarned: badgesCount,
          isLoading: false,
        });
        // Activity feed removed
      } catch (error) {
        console.error('[ProfileScreen] Error fetching profile statistics:', error);
        setStats(prev => ({ ...prev, isLoading: false }));
      }
    };
    fetchStats();
  }, [authUserId]);

  // ANNOTATION: The Supabase real-time subscriptions have been removed.
  // To re-implement real-time updates for stats and the activity feed,
  // you would need to use a technology like WebSockets or Server-Sent Events (SSE)
  // with your Hostinger backend. The component now only fetches data once on load.
  // The "Test" buttons will still update the UI state locally for demonstration.

  // Ensure a profile row exists for the authenticated user; if missing, create a minimal placeholder.
  // This effect is now redundant as authProfileService handles this, but kept for backward compatibility
  useEffect(() => {
    const ensureProfile = async () => {
      if (!authUserId) return;
      
      // Refresh the auth profile to ensure it's synced
      await refreshAuthProfile();
      
  // Also refresh normalized profile (local + supabase)
  await refreshUserProfile();
    };
    ensureProfile();
  }, [authUserId, refreshUserProfile, refreshAuthProfile]);

  // On-focus refresh to ensure latest avatar and fields are shown when returning
  useFocusEffect(
    React.useCallback(() => {
      let isActive = true;
      const run = async () => {
        try {
          await Promise.all([refreshAuthProfile(), refreshUserProfile()]);
        } catch (e) {
          console.warn('[ProfileScreen] focus refresh failed:', e);
        }
      };
      run();
      return () => { isActive = false };
    }, [refreshAuthProfile, refreshUserProfile])
  );

  // Listen for changes from settings screen and sync with new profile service / local cache (scoped per user)
  useEffect(() => {
    const load = async () => {
      try {
        // Prefer auth profile (Supabase-synced) first
        if (authProfile) {
          setProfileData({
            name: `@${authProfile.username}`,
            about: authProfile.about || "Bounty user",
            avatar: authProfile.avatar || "/placeholder.svg?height=80&width=80",
          })
        } else if (userProfile) {
          // Fallback to local/normalized profile
          setProfileData({
            name: userProfile.name ? `${userProfile.name} (@${userProfile.username})` : `@${userProfile.username}`,
            about: userProfile.bio || "Bounty user",
            avatar: userProfile.avatar || "/placeholder.svg?height=80&width=80",
          })
        } else {
          // Fallback to old storage
          const storedProfile = await AsyncStorage.getItem(`profileData:${authUserId || 'anon'}`)
          if (storedProfile) setProfileData(JSON.parse(storedProfile))
        }
        const storedSkills = await AsyncStorage.getItem(`profileSkills:${authUserId || 'anon'}`)
        if (storedSkills) {
          const parsed = JSON.parse(storedSkills)
          if (Array.isArray(parsed)) setSkills(parsed)
        } else {
          // Generate skills from profiles
          const defaultSkills: { id: string; icon: string; text: string; credentialUrl?: string }[] = []
          
          // Prefer auth profile data
          const profileToUse = authProfile || userProfile
          
          // If we have phone or location in the raw profile, prefer those
          const raw = (profileToUse as any)?._raw || null;
          if (raw && raw.phone) {
            defaultSkills.push({ id: '2', icon: 'verified-user', text: 'Verified contact' })
          }

          if (raw && raw.location) {
            defaultSkills.push({ id: '1', icon: 'location-on', text: `Based in ${raw.location}` })
          }
          
          if (authProfile?.created_at) {
            const joinDate = new Date(authProfile.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
            defaultSkills.push({ id: '3', icon: 'favorite', text: `Joined ${joinDate}` })
          } else {
            defaultSkills.push({ id: '3', icon: 'favorite', text: 'Joined December 28th 2024' })
          }
          
          setSkills(defaultSkills)
        }
      } catch (error) {
        console.error('Error fetching stored profile/skills:', error)
      }
    }
    load()
  // Only depend on primitive identity fields to avoid repeated triggers when objects change by ref
  }, [showSettings, userProfile?.username, authProfile?.id, authUserId])

  const handleSaveSkills = (updatedSkills: { id: string; icon: string; text: string; credentialUrl?: string }[]) => {
    setSkills(updatedSkills)
    setIsEditing(false)
  }

  const handleSettingsClose = async () => {
    setShowSettings(false)
    // Refresh profile data when returning from settings
    try {
      await Promise.all([refreshAuthProfile(), refreshUserProfile()])
      // Show brief success message
      setUpdateMessage('Profile refreshed')
      setTimeout(() => setUpdateMessage(null), 2000)
    } catch (error) {
      console.error('Error refreshing profile:', error)
      setUpdateMessage('Failed to refresh profile')
      setTimeout(() => setUpdateMessage(null), 3000)
    }
  }

  // Share the user's profile (name, about, skills and a shareable link)
  // NOTE: profileUrl is a placeholder. Replace with your real public profile URL scheme.
  const shareProfile = async () => {
    try {
  const skillsText = skills.length > 0 ? skills.map(s => s.text + (s.credentialUrl ? ` (${s.credentialUrl.split('/').pop()})` : '')).join(', ') : 'No skills listed'
  const profileUrl = authUserId ? `https://example.com/u/${authUserId}` : 'https://example.com'
      const message = `${profileData.name}\n\n${profileData.about}\n\nSkills: ${skillsText}\n\nView profile: ${profileUrl}`

      await Share.share({
        title: `${profileData.name} on Bounty`,
        message,
      })
    } catch (err) {
      console.error('Error sharing profile:', err)
    }
  }

  // Removed test simulation functions for activity

  if (isEditing) {
    return <SkillsetEditScreen initialSkills={skills} userId={authUserId} onBack={() => setIsEditing(false)} onSave={handleSaveSkills} />
  }

  if (showSettings) {
    return <SettingsScreen onBack={handleSettingsClose} />
  }

  if (showHistory) {
    return <HistoryScreen onBack={() => setShowHistory(false)} />
  }

  return (
    <View className="flex flex-col h-screen bg-emerald-600 text-white">
      {/* Update Message Banner */}
      {updateMessage && (
        <View style={{ position: 'absolute', top: 60, left: 16, right: 16, zIndex: 50 }}>
          <View className="bg-emerald-800 rounded-lg px-4 py-3 flex-row items-center justify-between shadow-lg">
            <Text className="text-white text-sm flex-1">{updateMessage}</Text>
            <TouchableOpacity onPress={() => setUpdateMessage(null)}>
              <MaterialIcons name="close" size={18} color="white" />
            </TouchableOpacity>
          </View>
        </View>
      )}
      {/* Header — left: BOUNTY brand, right: back + settings */}
      <View className="flex-row items-center justify-between p-4 pt-8">
        <View className="flex-row items-center gap-2">
          <MaterialIcons 
            name="gps-fixed" 
            size={24} 
            color="#ffffff" 
            accessibilityElementsHidden={true}
          />
          <Text 
            className="text-lg font-bold tracking-wider text-white"
            accessibilityRole="header"
          >
            BOUNTY
          </Text>
        </View>
        <View className="flex-row items-center">
          <TouchableOpacity 
            className="p-2" 
            onPress={shareProfile} 
            accessibilityRole="button"
            accessibilityLabel="Share profile"
            accessibilityHint="Share your profile via social media or messaging apps"
          >
            <MaterialIcons 
              name="share" 
              size={22} 
              color="#ffffff" 
              accessibilityElementsHidden={true}
            />
          </TouchableOpacity>
          <TouchableOpacity 
            className="p-2" 
            onPress={() => setShowSettings(true)} 
            accessibilityRole="button"
            accessibilityLabel="Open settings"
            accessibilityHint="Access profile settings and preferences"
          >
            <MaterialIcons 
              name="settings" 
              size={24} 
              color="#ffffff" 
              accessibilityElementsHidden={true}
            />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView className="flex-1 pb-40" contentContainerStyle={{ paddingBottom: 140 }}>
        {/* Profile + Stats merged card */}
        {isProfileReady ? (
          // If this is the signed-in user's profile, pass undefined so the hook resolves the "current-user" profile
          <EnhancedProfileSection 
            userId={isOwnProfile ? undefined : profileUuid} 
            isOwnProfile={isOwnProfile} 
            key={profileUuid}
            showPortfolio={false}
            activityStats={{
              jobsAccepted: stats.jobsAccepted,
              bountiesPosted: stats.bountiesPosted,
              badgesEarned: stats.badgesEarned,
            }}
          />
        ) : (
          <View className="px-4 py-4">
            <View className="bg-black/20 rounded-md p-3">
              <Text className="text-sm text-emerald-200">Loading profile…</Text>
            </View>
          </View>
        )}


        {/* Skillsets - simplified chip display */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Skillsets</Text>
            <TouchableOpacity
              style={styles.editButton}
              onPress={() => setIsEditing(true)}
            >
              <Text style={styles.editButtonText}>Edit</Text>
            </TouchableOpacity>
          </View>
          <SkillsetChips skills={skills} />
        </View>

        {/* Portfolio (standalone, after skillsets) */}
        <PortfolioSection userId={isOwnProfile ? undefined : profileUuid} isOwnProfile={isOwnProfile} />

        

        {/* Achievements - grid display (last) */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Achievements</Text>
          <AchievementsGrid badgesEarned={stats.badgesEarned} />
        </View>

        {/* Activity section removed per requirements */}

        {/* History Link */}
        <View className="px-4 py-2">
          <TouchableOpacity
            className="flex-row items-center justify-between bg-emerald-700/30 rounded-lg p-3 touch-target-min"
            onPress={() => {
              // Navigate to history screen
              setShowHistory(true)
            }}
          >
            <View className="flex-row items-center">
              <MaterialIcons name="history" size={20} color="#a7f3d0" />
              <Text className="text-sm font-medium text-white ml-2">View History</Text>
            </View>
            <MaterialIcons name="chevron-right" size={20} color="#a7f3d0" />
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Bottom navigation is now provided at app level; this spacer ensures content isn't obscured */}
    </View>
  )
}

// formatTimeAgo removed with Activity section

const styles = StyleSheet.create({
  section: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#ffffff",
  },
  editButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: "#10b981",
    borderRadius: 4,
  },
  editButtonText: {
    fontSize: 12,
    color: "#6ee7b7",
  },
});
