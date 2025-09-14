"use client"

import { bountyRequestService } from "lib/services/bounty-request-service"
import { bountyService } from "lib/services/bounty-service"
import { CURRENT_USER_ID } from "lib/utils/data-utils"
import { Award, CheckCircle, Code, FileText, Globe, Heart, Settings, Target } from "lucide-react"
import { useEffect, useState } from "react"
import { SettingsScreen } from "./settings-screen"
import { SkillsetEditScreen } from "./skillset-edit-screen"

// Update the ProfileScreen component to include real-time statistics
export function ProfileScreen({ onBack }: { onBack?: () => void } = {}) {
  const [isEditing, setIsEditing] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [profileData, setProfileData] = useState({
    name: "@jon_Doe",
    about: "Russian opportunist",
    avatar: "/placeholder.svg?height=80&width=80",
  })
  const [skills, setSkills] = useState<{ id: string; icon: string; text: string }[]>([
    { id: "1", icon: "code", text: "Knows English, Spanish" },
    { id: "2", icon: "target", text: "Private Investigator Certification" },
    { id: "3", icon: "heart", text: "Joined December 28th 2024" },
  ])

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
    const storedProfile = localStorage.getItem("profileData")
    if (storedProfile) {
      setProfileData(JSON.parse(storedProfile))
    }
  }, [showSettings])

  const getIconComponent = (iconName: string) => {
    switch (iconName) {
      case "code":
        return <Code className="h-4 w-4 text-emerald-300" />
      case "target":
        return <Target className="h-4 w-4 text-emerald-300" />
      case "heart":
        return <Heart className="h-4 w-4 text-emerald-300" />
      case "globe":
        return <Globe className="h-4 w-4 text-emerald-300" />
      default:
        return <Code className="h-4 w-4 text-emerald-300" />
    }
  }

  const handleSaveSkills = (updatedSkills: { id: string; icon: string; text: string }[]) => {
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
    return <SkillsetEditScreen onBack={() => setIsEditing(false)} onSave={handleSaveSkills} />
  }

  if (showSettings) {
    return <SettingsScreen onBack={handleSettingsClose} />
  }

  return (
    <div className="flex flex-col h-screen bg-emerald-600 text-white">
      {/* Header */}
      <div className="flex justify-between items-center p-4 pt-8">
        <button className="p-2" onClick={onBack}>
          <FileText className="h-5 w-5" />
        </button>
        <button className="p-2" onClick={() => setShowSettings(true)}>
          <Settings className="h-5 w-5" />
        </button>
      </div>

      {/* Profile Info */}
      <div className="px-4 py-2">
        <div className="flex items-center gap-4">
          <div className="relative">
            <div className="h-16 w-16 rounded-full bg-gray-700 flex items-center justify-center">
              <Target className="h-8 w-8" />
            </div>
            <div className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold px-1.5 py-0.5 rounded">
              lvl {Math.max(1, Math.floor(stats.badgesEarned / 2) + 1)}
            </div>
          </div>
          <div>
            <h1 className="text-lg font-bold">{profileData.name}</h1>
            <p className="text-sm text-emerald-200">{profileData.about}</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pb-4 hide-scrollbar">
        {/* Stats */}
        <div className="px-4 py-4">
          <div className="bg-black/30 backdrop-blur-sm rounded-xl p-4">
            <div className="grid grid-cols-3 gap-4 text-center">
              <div className="transition-all duration-300 transform hover:scale-105">
                <p className="text-2xl font-bold animate-pulse">{stats.jobsAccepted}</p>
                <p className="text-xs text-emerald-200 mt-1">Jobs Accepted</p>
              </div>
              <div className="transition-all duration-300 transform hover:scale-105">
                <p className="text-2xl font-bold animate-pulse">{stats.bountiesPosted}</p>
                <p className="text-xs text-emerald-200 mt-1">Bounties Posted</p>
              </div>
              <div className="transition-all duration-300 transform hover:scale-105">
                <p className="text-2xl font-bold animate-pulse">{stats.badgesEarned}</p>
                <p className="text-xs text-emerald-200 mt-1">Badges Earned</p>
              </div>
            </div>

            {/* Test buttons (hidden in production) */}
            <div className="mt-4 flex justify-center gap-2">
              <button onClick={simulateJobAccepted} className="px-2 py-1 bg-emerald-700 rounded-md text-xs">
                Test: Complete Job
              </button>
              <button onClick={simulateBountyPosted} className="px-2 py-1 bg-emerald-700 rounded-md text-xs">
                Test: Post Bounty
              </button>
            </div>
          </div>
        </div>

        {/* Skills */}
        <div className="px-4 py-2">
          <div className="flex justify-between items-center mb-2">
            <h2 className="text-sm font-medium">Skillsets:</h2>
            <button
              className="text-xs text-emerald-200 px-2 py-1 border border-emerald-500 rounded"
              onClick={() => setIsEditing(true)}
            >
              Edit
            </button>
          </div>

          <div className="space-y-3">
            {skills.map((skill) => (
              <div key={skill.id} className="flex items-center gap-2">
                {getIconComponent(skill.icon)}
                <p className="text-sm">{skill.text}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="px-4 py-4">
          <h2 className="text-sm font-medium mb-2">Activity</h2>
          <div className="space-y-4">
            {activities.length > 0 ? (
              activities.map((activity, i) => (
                <div key={i} className="bg-emerald-700/30 rounded-lg p-3">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-sm font-medium flex items-center gap-1">
                      {activity.type === "bounty_posted" && <Target className="h-3 w-3" />}
                      {activity.type === "job_accepted" && <CheckCircle className="h-3 w-3" />}
                      {activity.type === "badge_earned" && <Award className="h-3 w-3 text-yellow-400" />}
                      {activity.type === "bounty_posted"
                        ? "Bounty Posted"
                        : activity.type === "job_accepted"
                          ? "Job Accepted"
                          : "Badge Earned"}
                    </span>
                    <span className="text-xs text-emerald-300">{formatTimeAgo(activity.timestamp)}</span>
                  </div>
                  <p className="text-sm text-emerald-200">{activity.title}</p>
                </div>
              ))
            ) : (
              <div className="text-center py-4 text-emerald-300">
                <p>No activity yet</p>
              </div>
            )}
          </div>
        </div>

        <div className="px-4 py-4">
          <h2 className="text-sm font-medium mb-2">Achievements</h2>
          <div className="grid grid-cols-3 gap-3">
            {Array.from({ length: 6 }).map((_, i) => {
              const isEarned = i < stats.badgesEarned
              return (
                <div
                  key={i}
                  className={`bg-emerald-700/30 rounded-lg p-3 flex flex-col items-center justify-center aspect-square ${
                    isEarned ? "border border-yellow-400" : "opacity-50"
                  }`}
                >
                  <div
                    className={`h-10 w-10 rounded-full ${isEarned ? "bg-emerald-600" : "bg-emerald-800"} flex items-center justify-center mb-2`}
                  >
                    {i % 3 === 0 ? (
                      <Target className={`h-5 w-5 ${isEarned ? "text-yellow-400" : "text-emerald-300"}`} />
                    ) : i % 3 === 1 ? (
                      <Heart className={`h-5 w-5 ${isEarned ? "text-yellow-400" : "text-emerald-300"}`} />
                    ) : (
                      <Globe className={`h-5 w-5 ${isEarned ? "text-yellow-400" : "text-emerald-300"}`} />
                    )}
                  </div>
                  <span className="text-xs text-center">
                    {i % 3 === 0 ? "Sharpshooter" : i % 3 === 1 ? "Helper" : "Explorer"}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Bottom Navigation Indicator */}
      <div className="mt-auto flex justify-center pb-6">
        <div className="h-1 w-1 rounded-full bg-white/50 mx-1"></div>
        <div className="h-1 w-1 rounded-full bg-white/50 mx-1"></div>
        <div className="h-1 w-1 rounded-full bg-white/50 mx-1"></div>
        <div className="h-1 w-1 rounded-full bg-white mx-1"></div>
        <div className="h-1 w-1 rounded-full bg-white/50 mx-1"></div>
      </div>
    </div>
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
