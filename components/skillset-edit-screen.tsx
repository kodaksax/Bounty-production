"use client"

import { Code, Globe, Heart, Plus, Target, X } from "lucide-react"
import { useState } from "react"

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

  const getIconComponent = (iconName: string) => {
    switch (iconName) {
      case "code":
        return <Code className="h-5 w-5 text-red-500" />
      case "target":
        return <Target className="h-5 w-5 text-blue-500" />
      case "heart":
        return <Heart className="h-5 w-5 text-pink-500" />
      case "globe":
        return <Globe className="h-5 w-5 text-blue-500" />
      default:
        return <Code className="h-5 w-5" />
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
    <div className="flex flex-col min-h-screen bg-emerald-600 text-white">
      {/* Header */}
      <div className="flex justify-between items-center p-4 pt-8">
        <div className="flex items-center">
          <Target className="h-5 w-5 mr-2" />
          <span className="text-lg font-bold tracking-wider">BOUNTY</span>
        </div>
        <span className="text-lg font-bold">$ 40.00</span>
      </div>

      {/* Title with actions */}
      <div className="px-4 py-4 flex justify-between items-center">
        <button onClick={onBack} className="p-1">
          <X className="h-6 w-6" />
        </button>
        <h1 className="text-xl font-bold">Skillsets:</h1>
        <button onClick={addNewSkill} className="p-1">
          <Plus className="h-6 w-6" />
        </button>
      </div>

      {/* Skills list */}
      <div className="px-4 py-2 flex-1">
        <div className="space-y-4">
          {skills.map((skill) => (
            <div
              key={skill.id}
              className={`flex items-center bg-emerald-700/50 rounded-lg p-2 ${
                selectedSkill === skill.id ? "border-2 border-purple-500" : ""
              }`}
              onClick={() => setSelectedSkill(skill.id)}
            >
              <div className="h-10 w-10 rounded-full bg-emerald-800 flex items-center justify-center mr-3">
                {getIconComponent(skill.icon)}
              </div>
              <div className="flex-1">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-emerald-300">Icon:</span>
                  <span className="text-xs text-emerald-300">Skillset:</span>
                </div>
                <input
                  type="text"
                  value={skill.text}
                  onChange={(e) => handleSkillChange(skill.id, e.target.value)}
                  placeholder="Enter your skill"
                  className="w-full bg-transparent border-none focus:outline-none text-white placeholder:text-emerald-300/50"
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Bottom actions */}
      <div className="p-4 flex justify-between">
        <button onClick={() => removeSkill(selectedSkill)} className="px-4 py-2 bg-red-500/20 text-red-300 rounded-lg">
          Remove
        </button>
        <button onClick={handleSave} className="px-4 py-2 bg-emerald-700 text-white rounded-lg">
          Save
        </button>
      </div>
    </div>
  )
}
