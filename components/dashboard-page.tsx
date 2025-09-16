"use client"
import { DashboardHeader } from "components/dashboard-header"
import { DashboardSidebar } from "components/dashboard-sidebar"
import { Overview } from "components/overview"
import { RecentSales } from "components/recent-sales"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "components/ui/card"
import { SidebarProvider } from "components/ui/sidebar"
import * as React from "react"
import { Text, View } from "react-native"

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
                <CardHeader>
                  <CardTitle>Total Revenue</CardTitle>
                </CardHeader>
                <CardContent>
                  <View // @ts-ignore
                    className="text-2xl font-bold"
                  >
                    <Text>$45,231.89</Text>
                  </View>
                  <Text // @ts-ignore
                    className="text-xs text-muted-foreground"
                  >+20.1% from last month</Text>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Subscriptions</CardTitle>
                </CardHeader>
                <CardContent>
                  <View // @ts-ignore
                    className="text-2xl font-bold"
                  >
                    <Text>+2,350</Text>
                  </View>
                  <Text // @ts-ignore
                    className="text-xs text-muted-foreground"
                  >+180.1% from last month</Text>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Sales</CardTitle>
                </CardHeader>
                <CardContent>
                  <View // @ts-ignore
                    className="text-2xl font-bold"
                  >
                    <Text>+12,234</Text>
                  </View>
                  <Text // @ts-ignore
                    className="text-xs text-muted-foreground"
                  >+19% from last month</Text>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Active Now</CardTitle>
                </CardHeader>
                <CardContent>
                  <View // @ts-ignore
                    className="text-2xl font-bold"
                  >
                    <Text>+573</Text>
                  </View>
                  <Text // @ts-ignore
                    className="text-xs text-muted-foreground"
                  >+201 since last hour</Text>
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
