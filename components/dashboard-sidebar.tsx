"use client"

import { BarChart3, Users, Package, Settings, HelpCircle, LogOut, Home } from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "components/ui/avatar"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarSeparator,
} from "components/ui/sidebar"

export function DashboardSidebar() {
  return (
    <Sidebar>
      <SidebarHeader className="flex items-center px-4 py-2">
        <View className="flex items-center gap-2">
          <View className="rounded-md bg-primary p-1">
            <Package className="h-6 w-6 text-primary-foreground" />
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
                  <Home className="h-4 w-4" />
                  <Text>Dashboard</Text>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Analytics">
                  <BarChart3 className="h-4 w-4" />
                  <Text>Analytics</Text>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Customers">
                  <Users className="h-4 w-4" />
                  <Text>Customers</Text>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarSeparator />
        <SidebarGroup>
          <SidebarGroupLabel>Settings</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Settings">
                  <Settings className="h-4 w-4" />
                  <Text>Settings</Text>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Help">
                  <HelpCircle className="h-4 w-4" />
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
            <LogOut className="h-4 w-4" />
            <Text className="sr-only">Log out</Text>
          </TouchableOpacity>
        </View>
      </SidebarFooter>
    </Sidebar>
  )
}
