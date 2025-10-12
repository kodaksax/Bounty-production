"use client"
import { MaterialIcons } from "@expo/vector-icons";
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AchievementsGrid } from "components/achievements-grid";
import { EnhancedProfileSection } from "components/enhanced-profile-section";
import { HistoryScreen } from "components/history-screen";
import { SkillsetChips } from "components/skillset-chips";
import { bountyRequestService } from "lib/services/bounty-request-service";
import { bountyService } from "lib/services/bounty-service";
// Remove static CURRENT_USER_ID usage; we'll derive from authenticated session
// import { CURRENT_USER_ID } from "lib/utils/data-utils";
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

  // Add state for activity feed
  const [activities, setActivities] = useState<
    {
      type: string
      title: string
      timestamp: Date
    }[]
  >([])

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
        const newActivities = [
          ...postedBounties.map(b => ({ type: 'bounty_posted', title: `Posted bounty: ${b.title}`, timestamp: new Date(b.created_at) })),
          ...acceptedJobs.map(j => ({ type: 'job_accepted', title: 'Accepted a bounty request', timestamp: new Date(j.created_at) })),
        ].sort((a,b)=> b.timestamp.getTime() - a.timestamp.getTime());
        setActivities(newActivities.slice(0,5));
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

  // Function to simulate completing a job (for testing)
  const simulateJobAccepted = () => {
    setStats((prev) => ({
      ...prev,
      jobsAccepted: prev.jobsAccepted + 1,
    }))

    // Add to activity feed
    const newActivity = {
      type: "job_accepted",
      title: "Accepted a bounty request",
      timestamp: new Date(),
    }

    setActivities((prev) => [newActivity, ...prev.slice(0, 4)])

    // Check if we should award a new badge
    if ((stats.jobsAccepted + 1) % 5 === 0) {
      // Award a new badge every 5 jobs accepted
      setStats((prev) => ({
        ...prev,
        badgesEarned: prev.badgesEarned + 1,
      }))

      // Add badge earned activity
      const badgeActivity = {
        type: "badge_earned",
        title: "Earned a new badge: Bounty Hunter",
        timestamp: new Date(),
      }

      setActivities((prev) => [badgeActivity, ...prev.slice(0, 4)])
    }
  }

  // Function to simulate posting a bounty (for testing)
  const simulateBountyPosted = () => {
    setStats((prev) => ({
      ...prev,
      bountiesPosted: prev.bountiesPosted + 1,
    }))

    // Add to activity feed
    const newActivity = {
      type: "bounty_posted",
      title: "Posted a new bounty",
      timestamp: new Date(),
    }

    setActivities((prev) => [newActivity, ...prev.slice(0, 4)])

    // Check if we should award a new badge
    if ((stats.bountiesPosted + 1) % 3 === 0) {
      // Award a new badge every 3 bounties posted
      setStats((prev) => ({
        ...prev,
        badgesEarned: prev.badgesEarned + 1,
      }))

      // Add badge earned activity
      const badgeActivity = {
        type: "badge_earned",
        title: "Earned a new badge: Bounty Creator",
        timestamp: new Date(),
      }

      setActivities((prev) => [badgeActivity, ...prev.slice(0, 4)])
    }
  }

  if (isEditing) {
    return <SkillsetEditScreen initialSkills={skills} onBack={() => setIsEditing(false)} onSave={handleSaveSkills} />
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
        <View className="flex-row items-center">
          <MaterialIcons name="gps-fixed" size={24} color="#ffffff" />
          <Text className="text-lg font-bold tracking-wider ml-2 text-white">BOUNTY</Text>
        </View>
        <View className="flex-row items-center">
          <TouchableOpacity className="p-2" onPress={shareProfile} accessibilityLabel="Share profile">
            <MaterialIcons name="share" size={22} color="#ffffff" />
          </TouchableOpacity>
          <TouchableOpacity className="p-2" onPress={() => setShowSettings(true)} accessibilityLabel="Open settings">
            <MaterialIcons name="settings" size={24} color="#ffffff" />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView className="flex-1 pb-40" contentContainerStyle={{ paddingBottom: 140 }}>
        {/* Profile card (kodaksax, avatar, follow, portfolio) */}
        {isProfileReady ? (
          // If this is the signed-in user's profile, pass undefined so the hook resolves the "current-user" profile
          <EnhancedProfileSection userId={isOwnProfile ? undefined : profileUuid} isOwnProfile={isOwnProfile} key={profileUuid} />
        ) : (
          <View className="px-4 py-4">
            <View className="bg-black/20 rounded-md p-3">
              <Text className="text-sm text-emerald-200">Loading profile…</Text>
            </View>
          </View>
        )}

        {/* Stats */}
        <View className="px-4 py-4">
          <View className="bg-black/30 backdrop-blur-sm rounded-xl p-4">
            <View className="grid grid-cols-3 gap-4 text-center">
              <View className="transition-all duration-300 transform hover:scale-105">
                <Text className="text-2xl font-bold animate-pulse">{stats.jobsAccepted}</Text>
                <Text className="text-xs text-emerald-200 mt-1">Jobs Accepted</Text>
              </View>
              <View className="transition-all duration-300 transform hover:scale-105">
                <Text className="text-2xl font-bold animate-pulse">{stats.bountiesPosted}</Text>
                <Text className="text-xs text-emerald-200 mt-1">Bounties Posted</Text>
              </View>
              <View className="transition-all duration-300 transform hover:scale-105">
                <Text className="text-2xl font-bold animate-pulse">{stats.badgesEarned}</Text>
                <Text className="text-xs text-emerald-200 mt-1">Badges Earned</Text>
              </View>
            </View>
          </View>
        </View>

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

        {/* Achievements - grid display */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Achievements</Text>
          <AchievementsGrid badgesEarned={stats.badgesEarned} />
        </View>

        {/* Activity */}
        <View className="px-4 py-4">
          <Text className="text-sm font-medium mb-2">Activity</Text>
          <View className="space-y-4">
            {activities.length > 0 ? (
              activities.map((activity, i) => (
                <View key={i} className="bg-emerald-700/30 rounded-lg p-3">
                  <View className="flex justify-between items-center mb-1">
                    <Text className="text-sm font-medium flex items-center gap-1">
                      {activity.type === "bounty_posted" && <MaterialIcons name="gps-fixed" size={24} color="#ffffff" />}
                      {activity.type === "job_accepted" && <MaterialIcons name="check-circle" size={14} color="#ffffff" />}
                      {activity.type === "badge_earned" && <MaterialIcons name="emoji-events" size={14} color="#f59e0b" />}
                      {activity.type === "bounty_posted"
                        ? "Bounty Posted"
                        : activity.type === "job_accepted"
                          ? "Job Accepted"
                          : "Badge Earned"}
                    </Text>
                    <Text className="text-xs text-emerald-300">{formatTimeAgo(activity.timestamp)}</Text>
                  </View>
                  <Text className="text-sm text-emerald-200">{activity.title}</Text>
                </View>
              ))
            ) : (
              <View className="text-center py-4 text-emerald-300">
                <Text>No activity yet</Text>
              </View>
            )}
          </View>
        </View>

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

// Helper function to format time ago
function formatTimeAgo(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSecs = Math.floor(diffMs / 1000)
  const diffMins = Math.floor(diffMs / 60)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffSecs < 60) {
    return "just now"
  } else if (diffMins < 60) {
    return `${diffMins}m ago`
  } else if (diffHours < 24) {
    return `${diffHours}h ago`
  } else {
    return `${diffDays}d ago`
  }
}

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
