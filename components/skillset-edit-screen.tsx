"use client"

import { MaterialIcons } from "@expo/vector-icons"
import { useState } from "react"
import { Text, TextInput, TouchableOpacity, View } from "react-native"
import { useWallet } from '../lib/wallet-context'

interface SkillsetEditScreenProps {
  onBack?: () => void
  onSave?: (skills: Skill[]) => void
}

interface Skill {
  id: string
  icon: string
  text: string
}

export function SkillsetEditScreen({ onBack, onSave }: SkillsetEditScreenProps) {
  const [skills, setSkills] = useState<Skill[]>([
    { id: "1", icon: "code", text: "Knows English, Spanish" },
    { id: "2", icon: "target", text: "Private Investigator Certification" },
    { id: "3", icon: "heart", text: "Joined December 28th 2024" },
    { id: "4", icon: "globe", text: "" },
  ])

  const [selectedSkill, setSelectedSkill] = useState<string>("1")
  const { balance } = useWallet()

  const getIconComponent = (iconName: string) => {
    switch (iconName) {
      case 'code': return <MaterialIcons name="code" size={20} color="#ef4444" />
      case 'target': return <MaterialIcons name="gps-fixed" size={20} color="#000" />
      case 'heart': return <MaterialIcons name="favorite" size={20} color="#000" />
      case 'globe': return <MaterialIcons name="public" size={20} color="#3b82f6" />
      default: return <MaterialIcons name="code" size={20} color="#000" />
    }
  }

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

  return (
    <View className="flex flex-col min-h-screen bg-emerald-600 text-white">
      {/* Header */}
      <View className="flex justify-between items-center p-4 pt-8">
        <View className="flex items-center">
          <MaterialIcons name="gps-fixed" size={24} color="#000000" />
          <Text className="text-lg font-bold tracking-wider">BOUNTY</Text>
        </View>
  <Text className="text-lg font-bold">$ {balance.toFixed(2)}</Text>
      </View>

      {/* Title with actions */}
      <View className="px-4 py-4 flex justify-between items-center">
        <TouchableOpacity onPress={onBack} className="p-1">
          <MaterialIcons name="close" size={24} color="#000000" />
        </TouchableOpacity>
        <Text className="text-xl font-bold">Skillsets:</Text>
        <TouchableOpacity onPress={addNewSkill} className="p-1">
          <MaterialIcons name="add" size={24} color="#000000" />
        </TouchableOpacity>
      </View>

      {/* Skills list */}
      <View className="px-4 py-2 flex-1">
        <View className="space-y-4">
          {skills.map((skill) => (
            <TouchableOpacity
              key={skill.id}
              className={`flex items-center bg-emerald-700/50 rounded-lg p-2 ${
                selectedSkill === skill.id ? "border-2 border-purple-500" : ""
              }`}
              onPress={() => setSelectedSkill(skill.id)}
            >
              <View className="h-10 w-10 rounded-full bg-emerald-800 flex items-center justify-center mr-3">
                {getIconComponent(skill.icon)}
              </View>
              <View className="flex-1">
                <View className="flex justify-between items-center">
                  <Text className="text-xs text-emerald-300">Icon:</Text>
                  <Text className="text-xs text-emerald-300">Skillset:</Text>
                </View>
                <TextInput
                  value={skill.text}
                  onChangeText={(text) => handleSkillChange(skill.id, text)}
                  placeholder="Enter your skill"
                  className="w-full bg-transparent border-none focus:outline-none text-white placeholder:text-emerald-300/50"
                />
              </View>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Bottom actions */}
      <View className="p-4 flex justify-between">
        <TouchableOpacity onPress={() => removeSkill(selectedSkill)} className="px-4 py-2 bg-red-500/20 text-red-300 rounded-lg">
          Remove
        </TouchableOpacity>
        <TouchableOpacity onPress={handleSave} className="px-4 py-2 bg-emerald-700 text-white rounded-lg">
          Save
        </TouchableOpacity>
      </View>
    </View>
  )
}
