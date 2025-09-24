"use client"

import { MaterialIcons } from "@expo/vector-icons"
import * as DocumentPicker from 'expo-document-picker'
import { useState } from "react"
import { ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native"

interface SkillsetEditScreenProps {
  onBack?: () => void
  onSave?: (skills: Skill[]) => void
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
  const [skills, setSkills] = useState<Skill[]>([
    { id: "1", icon: "code", text: "Knows English, Spanish" },
    { id: "2", icon: "target", text: "Private Investigator Certification" },
    { id: "3", icon: "heart", text: "Joined December 28th 2024" },
    { id: "4", icon: "globe", text: "" },
  ])

  const [selectedSkill, setSelectedSkill] = useState<string>("1")
  const getIconComponent = (iconName: string) => <MaterialIcons name={iconName as any} size={20} color="#ffffff" />

  const handleSkillChange = (id: string, text: string) => {
    setSkills(skills.map((skill) => (skill.id === id ? { ...skill, text } : skill)))
  }

  const addNewSkill = () => {
    const newId = (Number.parseInt(skills[skills.length - 1].id) + 1).toString()
    setSkills([...skills, { id: newId, icon: "globe", text: "" }])
    setSelectedSkill(newId)
  }

  const removeSkill = (id: string) => {
    if (skills.length <= 1) return
    setSkills(skills.filter((skill) => skill.id !== id))
    setSelectedSkill(skills[0].id)
  }

  const handleSave = () => {
    if (onSave) {
      onSave(skills.filter((skill) => skill.text.trim() !== ""))
    }
    if (onBack) {
      onBack()
    }
  }

  const attachCredential = async (skillId: string) => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true })
      if (res.assets && res.assets.length > 0) {
        const uri = res.assets[0].uri
        setSkills(prev => prev.map(s => s.id === skillId ? { ...s, credentialUrl: uri } : s))
      }
    } catch (e) {
      // swallow for now; could add toast
    }
  }

  const changeIcon = (skillId: string, icon: string) => {
    setSkills(prev => prev.map(s => s.id === skillId ? { ...s, icon } : s))
  }

  return (
    <View className="flex flex-col min-h-screen bg-emerald-600 text-white">
      {/* Standard Header */}
      <View className="flex-row items-center justify-between p-4 pt-8">
        <View className="flex-row items-center">
          <MaterialIcons name="gps-fixed" size={24} color="#000000" />
          <Text className="text-lg font-bold tracking-wider ml-2">BOUNTY</Text>
        </View>
        <TouchableOpacity onPress={onBack} className="p-2">
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
                    <TouchableOpacity onPress={() => attachCredential(skill.id)} className="flex-1 mr-2 px-3 py-2 bg-emerald-800/60 rounded-lg flex-row items-center justify-center">
                      <MaterialIcons name="attach-file" size={18} color="#d1fae5" />
                      <Text className="text-emerald-100 text-sm ml-1">{skill.credentialUrl ? 'Replace Credential' : 'Attach Credential'}</Text>
                    </TouchableOpacity>
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
