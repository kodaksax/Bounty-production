"use client"
import { MaterialIcons } from "@expo/vector-icons"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "components/ui/card"
import { Overview } from "components/overview"
import { RecentSales } from "components/recent-sales"
import { DashboardHeader } from "components/dashboard-header"
import { DashboardSidebar } from "components/dashboard-sidebar"
import { SidebarProvider } from "components/ui/sidebar"

export function DashboardPage() {
  return (
    <SidebarProvider>
      <View className="flex min-h-screen">
        <DashboardSidebar />
        <View className="flex-1">
          <DashboardHeader />
          <main className="p-4 md:p-6 space-y-6">
            <View className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
                  <CreditCard className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <View className="text-2xl font-bold">$45,231.89</View>
                  <Text className="text-xs text-muted-foreground">+20.1% from last month</Text>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Subscriptions</CardTitle>
                  <Users className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <View className="text-2xl font-bold">+2,350</View>
                  <Text className="text-xs text-muted-foreground">+180.1% from last month</Text>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Sales</CardTitle>
                  <BarChart3 className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <View className="text-2xl font-bold">+12,234</View>
                  <Text className="text-xs text-muted-foreground">+19% from last month</Text>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Active Now</CardTitle>
                  <Activity className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <View className="text-2xl font-bold">+573</View>
                  <Text className="text-xs text-muted-foreground">+201 since last hour</Text>
                </CardContent>
              </Card>
            </View>
            <View className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
              <Card className="col-span-4">
                <CardHeader>
                  <CardTitle>Overview</CardTitle>
                </CardHeader>
                <CardContent className="pl-2">
                  <Overview />
                </CardContent>
              </Card>
              <Card className="col-span-3">
                <CardHeader>
                  <CardTitle>Recent Sales</CardTitle>
                  <CardDescription>You made 265 sales this month.</CardDescription>
                </CardHeader>
                <CardContent>
                  <RecentSales />
                </CardContent>
              </Card>
            </View>
          </main>
        </View>
      </View>
    </SidebarProvider>
  )
}
