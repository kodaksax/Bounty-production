"use client"

import { MaterialIcons } from "@expo/vector-icons"
import { View, Text, TextInput, TouchableOpacity } from "react-native"

export function DashboardHeader() {
  return (
    <View className="sticky top-0 z-10 flex h-16 items-center gap-4 border-b bg-background px-4 md:px-6">
      <TouchableOpacity>
        <MaterialIcons name="menu" size={24} color="#000000" />
      </TouchableOpacity>
      <View className="w-full flex-1 md:grow-0 md:w-72">
        <View className="relative">
          <MaterialIcons name="search" size={24} color="#000000" />
          <TextInput
            placeholder="Search..."
            className="w-full bg-background pl-8 md:w-[300px] lg:w-[400px]"
          />
        </View>
      </View>
      <View className="ml-auto flex items-center gap-2">
        <TouchableOpacity className="relative">
          <MaterialIcons name="notifications" size={24} color="#000000" />
          <Text className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground">
            3
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}
