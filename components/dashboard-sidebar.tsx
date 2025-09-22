"use client"

import { MaterialIcons } from "@expo/vector-icons"
import { Avatar, AvatarFallback, AvatarImage } from "components/ui/avatar"
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupContent,
    SidebarGroupLabel,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarSeparator,
} from "components/ui/sidebar"
import * as React from "react"
import { Text, TouchableOpacity, View } from "react-native"

export function DashboardSidebar() {
  return (
    <Sidebar>
      <SidebarHeader className="flex items-center px-4 py-2">
        <View className="flex items-center gap-2">
          <View className="rounded-md bg-primary p-1">
            <MaterialIcons name="local-shipping" size={24} color="#000000" />
          </View>
          <Text className="text-lg font-bold">Acme Inc</Text>
        </View>
      </SidebarHeader>
      <SidebarSeparator />
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton isActive tooltip="Dashboard">
                  <MaterialIcons name="home" size={24} color="#000000" />
                  <Text>Dashboard</Text>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Analytics">
                  <MaterialIcons name="bar-chart" size={18} color="#000000" />
                  <Text>Analytics</Text>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Customers">
                  <MaterialIcons name="people" size={18} color="#000000" />
                  <Text>Customers</Text>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarSeparator />
        <SidebarGroup>
          <SidebarGroupLabel>MaterialIcons</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="MaterialIcons">
                  <MaterialIcons name="settings" size={24} color="#000000" />
                  <Text>MaterialIcons</Text>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Help">
                  <MaterialIcons name="help" size={18} color="#000000" />
                  <Text>Help & Support</Text>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <View className="flex items-center justify-between px-4 py-2">
          <View className="flex items-center gap-2">
            <Avatar className="h-8 w-8">
              <AvatarImage src="/placeholder.svg?height=32&width=32" alt="User" />
              <AvatarFallback>JD</AvatarFallback>
            </Avatar>
            <View>
              <Text className="text-sm font-medium">John Doe</Text>
              <Text className="text-xs text-muted-foreground">john@example.com</Text>
            </View>
          </View>
          <TouchableOpacity className="rounded-md p-1 hover:bg-accent">
            <MaterialIcons name="logout" size={18} color="#000000" />
            <Text style={{ position: 'absolute', left: -9999 }}>Log out</Text>
          </TouchableOpacity>
        </View>
      </SidebarFooter>
    </Sidebar>
  )
}
