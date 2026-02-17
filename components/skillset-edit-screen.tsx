"use client"

import { MaterialIcons } from "@expo/vector-icons"
import AsyncStorage from '@react-native-async-storage/async-storage'
import { BrandingLogo } from "components/ui/branding-logo"
import * as DocumentPicker from 'expo-document-picker'
import { useEffect, useState } from "react"
import { ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native"
import { useAuthProfile } from '../hooks/useAuthProfile'
import { useUserProfile } from '../hooks/useUserProfile'

interface SkillsetEditScreenProps {
  onBack?: () => void
  onSave?: (skills: Skill[]) => void
  initialSkills?: Skill[]
  userId?: string // User ID for scoped storage to prevent data leaks
}

interface Skill {
  id: string
  icon: string
  text: string
  credentialUrl?: string // optional link to credential file (added)
}

const ICON_LIBRARY = [
  'code','gps-fixed','favorite','public','build','security','star','psychology','terminal','bug-report','camera','chat','school','palette','extension','language','cloud','schedule','storage','bolt','map','handshake','health-and-safety'
] as const

export function SkillsetEditScreen({ onBack, onSave, initialSkills, userId }: SkillsetEditScreenProps) {
  const { profile: localProfile, updateProfile } = useUserProfile();
  const { userId: authUserId } = useAuthProfile();

  const resolvedUserId = userId || authUserId;

  const [skills, setSkills] = useState<Skill[]>(() => initialSkills && initialSkills.length ? initialSkills : [
    { id: "1", icon: "code", text: "Knows English, Spanish" },
    { id: "2", icon: "gps-fixed", text: "Private Investigator Certification" },
    { id: "3", icon: "favorite", text: "Joined December 28th 2024" },
  ])

  const [selectedSkill, setSelectedSkill] = useState<string>("1")
  const alias: Record<string,string> = { heart: 'favorite', target: 'gps-fixed', globe: 'public' }
  const getIconComponent = (iconName: string) => <MaterialIcons name={(alias[iconName] || iconName) as any} size={20} color="#ffffff" />
  
  // User-specific storage key to prevent data leaks between users
  const SKILLS_STORAGE_KEY = `profileSkills:${resolvedUserId || 'anon'}`;

  // If prop changes while open (unlikely), sync once.
  useEffect(() => {
    if (initialSkills && initialSkills.length) {
      setSkills(initialSkills)
      return
    }

    // If no initialSkills provided, try loading from profile hook first
    if (localProfile && localProfile.skills && localProfile.skills.length > 0) {
      // Map string[] to Skill[] simple mapping
      const mapped: Skill[] = localProfile.skills.map((s, i) => ({ id: String(i + 1), icon: 'globe', text: s }))
      setSkills(mapped)
      return
    }

    // Otherwise leave defaults or load from AsyncStorage below
  }, [initialSkills, localProfile])

  const handleSkillChange = (id: string, text: string) => {
    setSkills(skills.map((skill) => (skill.id === id ? { ...skill, text } : skill)))
  }

  const [banner, setBanner] = useState<string | null>(null)

  const addNewSkill = () => {
    if (skills.length >= 4) {
      setBanner('Maximum of 4 skills reached')
      return
    }
    const lastId = skills.reduce((m,s)=>Math.max(m, Number.parseInt(s.id)||0),0)
    const newId = (lastId + 1).toString()
    setSkills([...skills, { id: newId, icon: "globe", text: "" }])
    setSelectedSkill(newId)
  }

  const removeSkill = (id: string) => {
    if (skills.length <= 1) return
    setSkills(skills.filter((skill) => skill.id !== id))
    setSelectedSkill(skills[0].id)
  }

  const handleSave = async () => {
    const cleaned = skills.filter((skill) => skill.text.trim() !== "")
    try {
      // Prefer persisting into the profile service when available so other screens (and backend) see the update
      if (updateProfile) {
        // extract text strings to match Profile shape
        const skillTexts = cleaned.map(s => s.text)
        const result = await updateProfile({ skills: skillTexts } as any)
        if (!result.success) {
          setBanner('Error saving skills to profile')
          setTimeout(()=>setBanner(null), 1500)
        } else {
          setBanner('Skills saved')
          setTimeout(()=>setBanner(null), 1500)
        }
      } else {
        await AsyncStorage.setItem(SKILLS_STORAGE_KEY, JSON.stringify(cleaned))
        setBanner('Skills saved')
        setTimeout(()=>setBanner(null), 1500)
      }
    } catch {
      setBanner('Error saving skills')
    }
    if (onSave) onSave(cleaned)
    if (onBack) onBack()
  }

  // Persist on change (debounced simple approach)
  useEffect(() => {
    const t = setTimeout(() => {
      // Keep AsyncStorage in sync as a fallback/local cache
      AsyncStorage.setItem(SKILLS_STORAGE_KEY, JSON.stringify(skills)).catch(() => {})
    }, 250)
    return () => clearTimeout(t)
  }, [skills, SKILLS_STORAGE_KEY])

  const attachCredential = async (skillId: string) => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true })
      if (res.canceled) return
      if (res.assets && res.assets.length > 0) {
        const uri = res.assets[0].uri
        setSkills(prev => prev.map(s => s.id === skillId ? { ...s, credentialUrl: uri } : s))
        setBanner('Credential attached')
        setTimeout(()=>setBanner(null), 1200)
      }
    } catch (e) {
      setBanner('Attachment failed')
      setTimeout(()=>setBanner(null), 1500)
    }
  }

  const removeCredential = (skillId: string) => {
    setSkills(prev => prev.map(s => s.id === skillId ? { ...s, credentialUrl: undefined } : s))
    setBanner('Credential removed')
    setTimeout(()=>setBanner(null), 1200)
  }

  const changeIcon = (skillId: string, icon: string) => {
    setSkills(prev => prev.map(s => s.id === skillId ? { ...s, icon } : s))
  }

  return (
    <View className="flex flex-col min-h-screen bg-emerald-600 text-white">
      {/* Standard Header */}
      <View className="flex-row items-center justify-between p-4 pt-8">
        <View className="flex-row items-center">
          <BrandingLogo size="small" />
        </View>
        <TouchableOpacity onPress={handleSave} className="p-2">
          <MaterialIcons name="close" size={24} color="#000000" />
        </TouchableOpacity>
      </View>

      {/* Actions Bar */}
      <View className="flex-row items-center justify-between px-4 pb-2">
        <Text className="text-base font-bold">Edit Skillsets</Text>
        <View className="flex-row">
          <TouchableOpacity onPress={addNewSkill} className="px-3 py-2 bg-emerald-700/60 rounded-lg mr-2">
            <Text className="text-white text-sm">Add</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleSave} className="px-3 py-2 bg-emerald-500 rounded-lg">
            <Text className="text-white text-sm font-semibold">Save</Text>
          </TouchableOpacity>
        </View>
      </View>

      {banner && (
        <View className="mx-4 mb-2 rounded-md bg-black/40 border border-emerald-300 px-3 py-2">
          <Text className="text-xs text-emerald-100">{banner}</Text>
        </View>
      )}
      <ScrollView className="flex-1" contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}>
        {skills.map(skill => {
          const isActive = selectedSkill === skill.id
          return (
            <View key={skill.id} className={`mb-4 rounded-xl p-4 ${isActive ? 'bg-emerald-700/60 border border-emerald-300' : 'bg-emerald-700/30'}`}> 
              <View className="flex-row items-center mb-3">
                <TouchableOpacity onPress={() => setSelectedSkill(skill.id)} className="h-12 w-12 rounded-full bg-black/30 items-center justify-center mr-3">
                  {getIconComponent(skill.icon)}
                </TouchableOpacity>
                <View className="flex-1">
                  <TextInput
                    value={skill.text}
                    onChangeText={(text) => handleSkillChange(skill.id, text)}
                    placeholder="Describe your skill or credential"
                    placeholderTextColor="#bbf7d0"
                    className="text-white text-sm"
                  />
                  {skill.credentialUrl && (
                    <Text className="text-emerald-200 text-xs mt-1" numberOfLines={1}>Attached: {skill.credentialUrl.split('/').pop()}</Text>
                  )}
                </View>
                <TouchableOpacity onPress={() => removeSkill(skill.id)} className="ml-2 p-2">
                  <MaterialIcons name="delete" size={20} color="#ffffff" />
                </TouchableOpacity>
              </View>
              {isActive && (
                <View>
                  {/* Icon Library */}
                  <Text className="text-xs font-semibold mb-1 text-emerald-200">Select Icon</Text>
                  <View className="flex-row flex-wrap -m-1 mb-3">
                    {ICON_LIBRARY.map(ic => (
                      <TouchableOpacity key={ic} onPress={() => changeIcon(skill.id, ic)} className={`m-1 h-9 w-9 rounded-lg items-center justify-center ${skill.icon === ic ? 'bg-emerald-500' : 'bg-emerald-800/60'}`}> 
                        <MaterialIcons name={ic as any} size={18} color={skill.icon === ic ? '#052e1b' : '#d1fae5'} />
                      </TouchableOpacity>
                    ))}
                  </View>
                  <View className="flex-row">
                    <TouchableOpacity onPress={() => attachCredential(skill.id)} className={`flex-1 ${skill.credentialUrl ? 'mr-2' : ''} px-3 py-2 bg-emerald-800/60 rounded-lg flex-row items-center justify-center`}>
                      <MaterialIcons name="attach-file" size={18} color="#d1fae5" />
                      <Text className="text-emerald-100 text-sm ml-1">{skill.credentialUrl ? 'Replace Credential' : 'Attach Credential'}</Text>
                    </TouchableOpacity>
                    {skill.credentialUrl && (
                      <TouchableOpacity onPress={() => removeCredential(skill.id)} className="flex-1 px-3 py-2 bg-red-600/70 rounded-lg flex-row items-center justify-center">
                        <MaterialIcons name="close" size={18} color="#fff" />
                        <Text className="text-white text-sm ml-1">Remove Credential</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              )}
            </View>
          )
        })}
      </ScrollView>
    </View>
  )
}
