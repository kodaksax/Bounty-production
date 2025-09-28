"use client"
import { MaterialIcons } from "@expo/vector-icons";
import AsyncStorage from '@react-native-async-storage/async-storage';
import { bountyRequestService } from "lib/services/bounty-request-service";
import { bountyService } from "lib/services/bounty-service";
import { CURRENT_USER_ID } from "lib/utils/data-utils";
import * as React from "react";
import { useEffect, useState } from "react";
import { ScrollView, Text, TouchableOpacity, View } from "react-native";
import { SettingsScreen } from "../../components/settings-screen";
import { SkillsetEditScreen } from "../../components/skillset-edit-screen";

// Update the ProfileScreen component to include real-time statistics
export function ProfileScreen({ onBack }: { onBack?: () => void } = {}) {
  const [isEditing, setIsEditing] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [profileData, setProfileData] = useState({
    name: "@jon_Doe",
    about: "Russian opportunist",
    avatar: "/placeholder.svg?height=80&width=80",
  })
  const [skills, setSkills] = useState<{ id: string; icon: string; text: string; credentialUrl?: string }[]>([])

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

  // Fetch initial statistics from Supabase
  useEffect(() => {
    const fetchStats = async () => {
      try {
        // Fetch bounties posted by the user
        const postedBounties = await bountyService.getByUserId(CURRENT_USER_ID)

        // Fetch bounty requests accepted by the user
        const acceptedRequests = await bountyRequestService.getByUserId(CURRENT_USER_ID)
        const acceptedJobs = acceptedRequests.filter((req) => req.status === "accepted")

        // For badges, we'll just use a mock value for now
        const badgesCount = Math.min(postedBounties.length, 3) // Mock calculation

        setStats({
          jobsAccepted: acceptedJobs.length,
          bountiesPosted: postedBounties.length,
          badgesEarned: badgesCount,
          isLoading: false,
        })

        // Generate activity feed based on bounties and requests
        const newActivities = [
          ...postedBounties.map((bounty) => ({
            type: "bounty_posted",
            title: `Posted bounty: ${bounty.title}`,
            timestamp: new Date(bounty.created_at),
          })),
          ...acceptedJobs.map((job) => ({
            type: "job_accepted",
            title: "Accepted a bounty request",
            timestamp: new Date(job.created_at),
          })),
        ]

        // Sort by timestamp, newest first
        newActivities.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())

        setActivities(newActivities.slice(0, 5)) // Show only the 5 most recent activities
      } catch (error) {
        console.error("Error fetching profile statistics:", error)
        setStats((prev) => ({ ...prev, isLoading: false }))
      }
    }

    fetchStats()
  }, [])

  // ANNOTATION: The Supabase real-time subscriptions have been removed.
  // To re-implement real-time updates for stats and the activity feed,
  // you would need to use a technology like WebSockets or Server-Sent Events (SSE)
  // with your Hostinger backend. The component now only fetches data once on load.
  // The "Test" buttons will still update the UI state locally for demonstration.

  // Listen for changes from settings screen
  useEffect(() => {
    const load = async () => {
      try {
        const storedProfile = await AsyncStorage.getItem("profileData")
        if (storedProfile) setProfileData(JSON.parse(storedProfile))
        const storedSkills = await AsyncStorage.getItem('profileSkills')
        if (storedSkills) {
          const parsed = JSON.parse(storedSkills)
          if (Array.isArray(parsed)) setSkills(parsed)
        } else {
          setSkills([
            { id: '1', icon: 'code', text: 'Knows English, Spanish' },
            { id: '2', icon: 'gps-fixed', text: 'Private Investigator Certification' },
            { id: '3', icon: 'favorite', text: 'Joined December 28th 2024' },
          ])
        }
      } catch (error) {
        console.error('Error fetching stored profile/skills:', error)
      }
    }
    load()
  }, [showSettings])

  const getIconComponent = (iconName: string) => {
    const alias: Record<string,string> = { heart: 'favorite', target: 'gps-fixed', globe: 'public' }
    const resolved = alias[iconName] || iconName
    return <MaterialIcons name={resolved as any} size={16} color="#34d399" />
  }

  const handleSaveSkills = (updatedSkills: { id: string; icon: string; text: string; credentialUrl?: string }[]) => {
    setSkills(updatedSkills)
    setIsEditing(false)
  }

  const handleSettingsClose = () => {
    setShowSettings(false)
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

  return (
    <View className="flex flex-col h-screen bg-emerald-600 text-white">
      {/* Header — left: BOUNTY brand, right: back + settings */}
      <View className="flex-row items-center justify-between p-4 pt-8">
        <View className="flex-row items-center">
          <MaterialIcons name="gps-fixed" size={24} color="#fffef5" />
          <Text className="text-lg font-bold tracking-wider ml-2">BOUNTY</Text>
        </View>
        <View className="flex-row items-center">
          <TouchableOpacity className="p-2" onPress={() => setShowSettings(true)}>
            <MaterialIcons name="settings" size={24} color="#fffef5" />
          </TouchableOpacity>
        </View>
      </View>

      <View className="flex-1 overflow-y-auto pb-40 hide-scrollbar">
        {/* Stats + Profile Info (profile moved inside the stats card) */}
        <View className="px-4 py-4">
          <View className="bg-black/30 backdrop-blur-sm rounded-xl p-4">
            {/* Profile header inside the stats card */}
            <View className="flex-row items-center mb-4">
              <View className="relative">
                <View className="h-16 w-16 rounded-full bg-gray-700 flex items-center justify-center">
                  <MaterialIcons name="gps-fixed" size={24} color="#fffef5" />
                </View>
                <View className="absolute -top-1 -right-1 bg-red-500 rounded">
                  <Text className="text-white text-xs font-bold px-1.5 py-0.5">
                    lvl {Math.max(1, Math.floor(stats.badgesEarned / 2) + 1)}
                  </Text>
                </View>
              </View>
              <View className="ml-4">
                <Text className="text-lg font-bold">{profileData.name}</Text>
                <Text className="text-sm text-emerald-200">{profileData.about}</Text>
              </View>
            </View>

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

            {/* Test buttons (hidden in production) */}
            <View className="mt-4 flex justify-center gap-2">
              <TouchableOpacity onPress={simulateJobAccepted} className="px-2 py-1 bg-emerald-700 rounded-md text-xs">
                Test: Complete Job
              </TouchableOpacity>
              <TouchableOpacity onPress={simulateBountyPosted} className="px-2 py-1 bg-emerald-700 rounded-md text-xs">
                Test: Post Bounty
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Skills */}
        <View className="px-4 py-2">
          {/* Header: title left, edit button right */}
          <View className="flex-row justify-between items-center mb-2">
            <Text className="text-sm font-medium">Skillsets</Text>
            <TouchableOpacity
              className="px-2 py-1 border border-emerald-500 rounded"
              onPress={() => setIsEditing(true)}
            >
              <Text className="text-xs text-emerald-200">Edit</Text>
            </TouchableOpacity>
          </View>

          {/* Skill items: text left, icon right */}
          <ScrollView style={{ maxHeight: 200 }} contentContainerStyle={{ paddingBottom: 10 }}>
          <View className="space-y-3">
            {skills.map((skill) => (
              <View key={skill.id} className="flex-row justify-between items-center bg-emerald-700/20 rounded-lg p-3">
                <View className="flex-1 pr-2">
                  <Text className="text-sm text-emerald-100" numberOfLines={2}>{skill.text}</Text>
                  {skill.credentialUrl && (
                    <View className="flex-row items-center mt-1">
                      <MaterialIcons name="attach-file" size={14} color="#a7f3d0" />
                      <Text className="text-xs text-emerald-200 ml-1" numberOfLines={1}>{skill.credentialUrl.split('/').pop()}</Text>
                    </View>
                  )}
                </View>
                <View className="ml-2 h-8 w-8 rounded-full bg-black/30 items-center justify-center">
                  {getIconComponent(skill.icon)}
                </View>
              </View>
            ))}
          </View>
          </ScrollView>
        </View>

        <View className="px-4 py-4">
          <Text className="text-sm font-medium mb-2">Activity</Text>
          <View className="space-y-4">
            {activities.length > 0 ? (
              activities.map((activity, i) => (
                <View key={i} className="bg-emerald-700/30 rounded-lg p-3">
                  <View className="flex justify-between items-center mb-1">
                    <Text className="text-sm font-medium flex items-center gap-1">
                      {activity.type === "bounty_posted" && <MaterialIcons name="gps-fixed" size={14} color="#fffef5" />}
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

        <View className="px-4 py-4">
          <Text className="text-sm font-medium mb-2">Achievements</Text>
          <View className="grid grid-cols-3 gap-3">
            {Array.from({ length: 6 }).map((_, i) => {
              const isEarned = i < stats.badgesEarned
              return (
                <View
                  key={i}
                  className={`bg-emerald-700/30 rounded-lg p-3 flex flex-col items-center justify-center aspect-square ${
                    isEarned ? "border border-yellow-400" : "opacity-50"
                  }`}
                >
                  <View
                    className={`h-10 w-10 rounded-full ${isEarned ? "bg-emerald-600" : "bg-emerald-800"} flex items-center justify-center mb-2`}
                  >
                    {i % 3 === 0 ? (
                      <MaterialIcons name="gps-fixed" size={20} color="#fffef5" />
                    ) : i % 3 === 1 ? (
                      <MaterialIcons name="favorite" size={20} color="#fffef5" />
                    ) : (
                      <MaterialIcons name="public" size={20} color={isEarned ? "#f59e0b" : "#34d399"} />
                    )}
                  </View>
                  <Text className="text-xs text-center">
                    {i % 3 === 0 ? "Sharpshooter" : i % 3 === 1 ? "Helper" : "Explorer"}
                  </Text>
                </View>
              )
            })}
          </View>
        </View>
      </View>

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
