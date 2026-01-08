"use client"

import { cn } from "lib/utils"
import type { ReactNode } from "react"
import { Text, TouchableOpacity, View } from "react-native"

interface CategoryFilterProps {
  label: string
  icon?: ReactNode
  isActive?: boolean
  onClick?: () => void
}

export function CategoryFilter({ label, icon, isActive = false, onClick }: CategoryFilterProps) {
  return (
    <TouchableOpacity accessibilityRole="button"
      onPress={onClick}
      className={cn(
        "flex items-center space-x-2 px-5 py-2.5 rounded-full whitespace-nowrap touch-target-min shadow-sm",
        isActive ? "bg-emerald-800/80 text-white" : "bg-white/20 text-white/90",
      )}
    >
      {icon && <View className="text-lg">{icon}</View>}
      <Text className="text-base font-medium">{label}</Text>
    </TouchableOpacity>
  )
}
