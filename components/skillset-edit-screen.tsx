"use client"

import { MaterialIcons } from "@expo/vector-icons"
import { BrandingLogo } from "components/ui/branding-logo"
import { useEffect, useRef, useState } from "react"
import { Text, TextInput, TouchableOpacity, View } from "react-native"
import { useAuthProfile } from '../hooks/useAuthProfile'
import { CapabilityEditor } from './capability-editor'
import { BOUNTY_CATEGORIES } from '../lib/constants/bounty-categories'
import { analyticsService } from '../lib/services/analytics-service'
import { useAppThemeContext } from '../lib/themes/AppThemeContext'

import { KeyboardAwareScrollView } from './ui/keyboard-avoiding';
interface SkillsetEditScreenProps {
  onBack?: () => void
  onSave?: (skills: Skill[]) => void
  initialSkills?: Skill[]
  userId?: string // Legacy prop; persistence uses the authenticated owner
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

export function SkillsetEditScreen({ onBack, onSave }: SkillsetEditScreenProps) {
  const { theme } = useAppThemeContext();
  const { profile: authProfile, userId: authUserId, updateProfile, loading, profileFetchError, refreshProfile } = useAuthProfile();
  const profileReady = !!authUserId && authProfile?.id === authUserId && !loading && !profileFetchError;
  const editState = useRef({ owner: authUserId, skillsDirty: false, categoriesDirty: false });

  const [skills, setSkills] = useState<Skill[]>(() =>
    (profileReady ? authProfile?.skills || [] : []).map((text, i) => ({ id: String(i + 1), icon: 'public', text })))

  // Preset skill-category tags (Tech/Design/Writing/Labor/Delivery/Other),
  // saved as profile metadata for a future recommended-bounty notification
  // feature. Distinct from the free-text skills below.
  const [selectedCategories, setSelectedCategories] = useState<string[]>(
    () => profileReady ? authProfile?.skill_categories ?? [] : []
  )

  const toggleCategory = (categoryId: string) => {
    if (!profileReady) return
    editState.current.categoriesDirty = true
    setSelectedCategories((prev) =>
      prev.includes(categoryId) ? prev.filter((c) => c !== categoryId) : [...prev, categoryId]
    )
  }

  const [selectedSkill, setSelectedSkill] = useState<string>("1")
  const alias: Record<string,string> = { heart: 'favorite', target: 'gps-fixed', globe: 'public' }
  const getIconComponent = (iconName: string) => <MaterialIcons name={(alias[iconName] || iconName) as any} size={20} color={theme.text} />
  
  useEffect(() => {
    if (editState.current.owner !== authUserId) {
      editState.current = { owner: authUserId, skillsDirty: false, categoriesDirty: false }
      setSelectedSkill("1")
      setSkills([])
      setSelectedCategories([])
    }
    if (!profileReady) return
    if (!editState.current.skillsDirty) {
      setSkills((authProfile?.skills || []).map((text, i) => ({ id: String(i + 1), icon: 'public', text })))
    }
    if (!editState.current.categoriesDirty) {
      setSelectedCategories(authProfile?.skill_categories || [])
    }
  }, [authProfile?.skills, authProfile?.skill_categories, authUserId, profileReady])

  const handleSkillChange = (id: string, text: string) => {
    if (!profileReady) return
    editState.current.skillsDirty = true
    setSkills(skills.map((skill) => (skill.id === id ? { ...skill, text } : skill)))
  }

  const [banner, setBanner] = useState<string | null>(null)

  const addNewSkill = () => {
    if (!profileReady) return
    if (skills.length >= 4) {
      setBanner('Maximum of 4 skills reached')
      return
    }
    const lastId = skills.reduce((m,s)=>Math.max(m, Number.parseInt(s.id)||0),0)
    const newId = (lastId + 1).toString()
    editState.current.skillsDirty = true
    setSkills([...skills, { id: newId, icon: "globe", text: "" }])
    setSelectedSkill(newId)
  }

  const removeSkill = (id: string) => {
    if (!profileReady) return
    editState.current.skillsDirty = true
    const remaining = skills.filter((skill) => skill.id !== id)
    setSkills(remaining)
    setSelectedSkill(remaining[0]?.id || '')
  }

  const handleSave = async () => {
    if (!profileReady) return
    const cleaned = skills.filter((skill) => skill.text.trim() !== "")
    try {
      // Persist via the authenticated profile service so the update actually
      // reaches Supabase (and is visible to other users / other devices),
      // not just this device's local cache.
      if (updateProfile) {
        // extract text strings to match Profile shape
        const skillTexts = cleaned.map(s => s.text)
        // Diffed against what was actually persisted before this save (not
        // local component state, which can churn on every keystroke) so
        // skill_added/skill_removed fire once per real change, only after
        // the write actually succeeds below.
        const previousSkills = authProfile?.skills ?? []
        const result = await updateProfile({ skills: skillTexts, skill_categories: selectedCategories })
        if (!result) {
          setBanner('Error saving skills to profile')
          return
        } else {
          editState.current.skillsDirty = false
          editState.current.categoriesDirty = false
          const added = skillTexts.filter(s => !previousSkills.includes(s))
          const removed = previousSkills.filter(s => !skillTexts.includes(s))
          if (added.length) analyticsService.trackEvent('skill_added', { count: added.length })
          if (removed.length) analyticsService.trackEvent('skill_removed', { count: removed.length })
          setBanner('Skills saved')
          setTimeout(()=>setBanner(null), 1500)
        }
      } else {
        setBanner('Sign in to save skills')
        return
      }
    } catch {
      setBanner('Error saving skills')
      return
    }
    if (onSave) onSave(cleaned)
    if (onBack) onBack()
  }

  // Disabled: this only ever stored a local file:// URI in this device's
  // AsyncStorage/React state and was dropped entirely from handleSave's
  // payload to updateProfile (only skill text is sent) -- no other user or
  // device could ever see an attached credential, so the button implied an
  // upload that never happened. Re-enable only once credentials actually
  // upload to Supabase Storage and persist server-side (see
  // hooks/use-portfolio-upload.ts for the pattern to reuse).
  const attachCredential = async (_skillId: string) => {
    setBanner('Credential uploads are coming soon')
    setTimeout(()=>setBanner(null), 1500)
  }

  const removeCredential = (skillId: string) => {
    if (!profileReady) return
    editState.current.skillsDirty = true
    setSkills(prev => prev.map(s => s.id === skillId ? { ...s, credentialUrl: undefined } : s))
    setBanner('Credential removed')
    setTimeout(()=>setBanner(null), 1200)
  }

  const changeIcon = (skillId: string, icon: string) => {
    if (!profileReady) return
    editState.current.skillsDirty = true
    setSkills(prev => prev.map(s => s.id === skillId ? { ...s, icon } : s))
  }

  return (
    <View className="flex flex-col min-h-screen" style={{ backgroundColor: theme.background }}>
      {/* Standard Header */}
      <View className="flex-row items-center justify-between p-4 pt-8">
        <View className="flex-row items-center">
          <BrandingLogo size="small" />
        </View>
        <TouchableOpacity
          onPress={handleSave}
          disabled={!profileReady}
          className="p-2"
          accessibilityRole="button"
          accessibilityLabel="Save and close"
          accessibilityState={{ disabled: !profileReady }}
          accessibilityHint="Saves skillset changes and returns to profile"
        >
          <MaterialIcons name="check" size={24} color={theme.text} />
        </TouchableOpacity>
      </View>

      {/* Actions Bar */}
      <View className="flex-row items-center justify-between px-4 pb-2">
        <Text className="text-base font-bold" style={{ color: theme.text }}>Edit Skillsets</Text>
        <View className="flex-row">
          <TouchableOpacity onPress={addNewSkill} disabled={!profileReady} className="px-3 py-2 rounded-lg mr-2" style={{ backgroundColor: theme.surfaceSecondary }} accessibilityRole="button" accessibilityLabel="Add new skill" accessibilityState={{ disabled: !profileReady }}>
            <Text className="text-sm" style={{ color: theme.text }}>Add</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleSave} disabled={!profileReady} className="px-3 py-2 bg-[#008E2A] rounded-lg" accessibilityRole="button" accessibilityLabel="Save skillsets" accessibilityState={{ disabled: !profileReady }}>
            <Text className="text-white text-sm font-semibold">Save</Text>
          </TouchableOpacity>
        </View>
      </View>

      {!profileReady && (
        <View className="mx-4 mb-2">
          <Text style={{ color: theme.textSecondary }}>Load your profile before editing skills.</Text>
          <TouchableOpacity onPress={() => { void refreshProfile().catch(() => {}) }} accessibilityRole="button" accessibilityLabel="Retry profile loading">
            <Text style={{ color: theme.primary }}>Retry</Text>
          </TouchableOpacity>
          {onBack && <TouchableOpacity onPress={onBack} accessibilityRole="button" accessibilityLabel="Cancel skill editing">
            <Text style={{ color: theme.text }}>Cancel</Text>
          </TouchableOpacity>}
        </View>
      )}
      {banner && (
        <View className="mx-4 mb-2 rounded-md px-3 py-2" style={{ backgroundColor: theme.surfaceSecondary, borderWidth: 1, borderColor: theme.border }}>
          <Text className="text-xs" style={{ color: theme.text }}>{banner}</Text>
        </View>
      )}
      <KeyboardAwareScrollView className="flex-1" contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}>
        <CapabilityEditor />
        {/* Preset skill categories */}
        <View className="mb-5">
          <Text className="text-sm font-semibold mb-1" style={{ color: theme.text }}>Skill Categories</Text>
          <Text className="text-xs mb-3" style={{ color: theme.textSecondary }}>
            Select the kinds of work you're good at. This helps us recommend bounties for you.
          </Text>
          <View className="flex-row flex-wrap -m-1">
            {BOUNTY_CATEGORIES.map((category) => {
              const isSelected = selectedCategories.includes(category.id)
              return (
                <TouchableOpacity
                  key={category.id}
                  onPress={() => toggleCategory(category.id)}
                  disabled={!profileReady}
                  className="m-1 flex-row items-center px-4 py-2 rounded-full"
                  style={{ backgroundColor: isSelected ? theme.primary : theme.surfaceSecondary }}
                  accessibilityRole="button"
                  accessibilityLabel={`${isSelected ? 'Remove' : 'Add'} ${category.label} skill category`}
                  accessibilityState={{ selected: isSelected, disabled: !profileReady }}
                >
                  <MaterialIcons
                    name={category.icon as any}
                    size={16}
                    color={isSelected ? '#fff' : theme.textSecondary}
                  />
                  <Text
                    className="ml-2 text-sm font-medium"
                    style={{ color: isSelected ? '#fff' : theme.text }}
                  >
                    {category.label}
                  </Text>
                </TouchableOpacity>
              )
            })}
          </View>
        </View>

        {skills.map(skill => {
          const isActive = selectedSkill === skill.id
          return (
            <View key={skill.id} className="mb-4 rounded-xl p-4" style={{ backgroundColor: isActive ? theme.surfaceSecondary : theme.surface, borderWidth: isActive ? 1 : 0, borderColor: theme.border }}>
              <View className="flex-row items-center mb-3">
                <TouchableOpacity onPress={() => setSelectedSkill(skill.id)} className="h-12 w-12 rounded-full items-center justify-center mr-3" style={{ backgroundColor: theme.surfaceSecondary }}>
                  {getIconComponent(skill.icon)}
                </TouchableOpacity>
                <View className="flex-1">
                  <TextInput
                    value={skill.text}
                    editable={profileReady}
                    onChangeText={(text) => handleSkillChange(skill.id, text)}
                    placeholder="Describe your skill or credential"
                    placeholderTextColor={theme.textDisabled}
                    className="text-sm"
                    style={{ color: theme.text }}
                  />
                  {skill.credentialUrl && (
                    <Text className="text-xs mt-1" style={{ color: theme.primaryLight }} numberOfLines={1}>Attached: {skill.credentialUrl.split('/').pop()}</Text>
                  )}
                </View>
                <TouchableOpacity
                  onPress={() => removeSkill(skill.id)}
                  disabled={!profileReady}
                  className="ml-2 p-2"
                  accessibilityRole="button"
                  accessibilityLabel="Delete skill"
                  accessibilityState={{ disabled: !profileReady }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <MaterialIcons name="delete" size={20} color={theme.text} />
                </TouchableOpacity>
              </View>
              {isActive && (
                <View>
                  {/* Icon Library */}
                  <Text className="text-xs font-semibold mb-1" style={{ color: theme.textSecondary }}>Select Icon</Text>
                  <View className="flex-row flex-wrap -m-1 mb-3">
                    {ICON_LIBRARY.map(ic => (
                      <TouchableOpacity
                        key={ic}
                        onPress={() => changeIcon(skill.id, ic)}
                        disabled={!profileReady}
                        className="m-1 h-11 w-11 rounded-lg items-center justify-center"
                        style={{ backgroundColor: skill.icon === ic ? theme.primary : theme.surfaceSecondary }}
                        accessibilityRole="button"
                        accessibilityLabel={`Select ${ic} icon`}
                        accessibilityState={{ selected: skill.icon === ic, disabled: !profileReady }}
                      >
                        <MaterialIcons name={ic as any} size={18} color={skill.icon === ic ? '#ffffff' : theme.primaryLight} />
                      </TouchableOpacity>
                    ))}
                  </View>
                  <View className="flex-row">
                    <TouchableOpacity
                      onPress={() => attachCredential(skill.id)}
                      className={`flex-1 ${skill.credentialUrl ? 'mr-2' : ''} px-3 py-2 rounded-lg flex-row items-center justify-center opacity-60`}
                      style={{ backgroundColor: theme.surfaceSecondary }}
                      accessibilityRole="button"
                      accessibilityLabel="Attach credential file, coming soon"
                    >
                      <MaterialIcons name="attach-file" size={18} color={theme.primaryLight} accessibilityElementsHidden />
                      <Text className="text-sm ml-1" style={{ color: theme.primaryLight }}>Attach Credential (Coming soon)</Text>
                    </TouchableOpacity>
                    {skill.credentialUrl && (
                      <TouchableOpacity
                        onPress={() => removeCredential(skill.id)}
                        className="flex-1 px-3 py-2 bg-red-600/70 rounded-lg flex-row items-center justify-center"
                        accessibilityRole="button"
                        accessibilityLabel="Remove credential file"
                      >
                        <MaterialIcons name="close" size={18} color="#fff" accessibilityElementsHidden />
                        <Text className="text-white text-sm ml-1">Remove Credential</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              )}
            </View>
          )
        })}
      </KeyboardAwareScrollView>
    </View>
  )
}
