import { Avatar, AvatarFallback, AvatarImage } from "components/ui/avatar"
import * as React from "react"
import { Text, View } from "react-native"

export function RecentSales() {
  return (
    <View className="space-y-8">
      <View className="flex items-center">
        <Avatar className="h-9 w-9">
          <AvatarImage src="/placeholder.svg?height=36&width=36" alt="Avatar" />
          <AvatarFallback>OM</AvatarFallback>
        </Avatar>
        <View className="ml-4 space-y-1">
          <Text className="text-sm font-medium leading-none">Olivia Martin</Text>
          <Text className="text-sm text-muted-foreground">olivia.martin@email.com</Text>
        </View>
  <Text className="ml-auto font-medium">+$1,999.00</Text>
      </View>
      <View className="flex items-center">
        <Avatar className="flex h-9 w-9 items-center justify-center space-y-0 border">
          <AvatarImage src="/placeholder.svg?height=36&width=36" alt="Avatar" />
          <AvatarFallback>JL</AvatarFallback>
        </Avatar>
        <View className="ml-4 space-y-1">
          <Text className="text-sm font-medium leading-none">Jackson Lee</Text>
          <Text className="text-sm text-muted-foreground">jackson.lee@email.com</Text>
        </View>
  <Text className="ml-auto font-medium">+$39.00</Text>
      </View>
      <View className="flex items-center">
        <Avatar className="h-9 w-9">
          <AvatarImage src="/placeholder.svg?height=36&width=36" alt="Avatar" />
          <AvatarFallback>IN</AvatarFallback>
        </Avatar>
        <View className="ml-4 space-y-1">
          <Text className="text-sm font-medium leading-none">Isabella Nguyen</Text>
          <Text className="text-sm text-muted-foreground">isabella.nguyen@email.com</Text>
        </View>
  <Text className="ml-auto font-medium">+$299.00</Text>
      </View>
      <View className="flex items-center">
        <Avatar className="h-9 w-9">
          <AvatarImage src="/placeholder.svg?height=36&width=36" alt="Avatar" />
          <AvatarFallback>WK</AvatarFallback>
        </Avatar>
        <View className="ml-4 space-y-1">
          <Text className="text-sm font-medium leading-none">William Kim</Text>
          <Text className="text-sm text-muted-foreground">will@email.com</Text>
        </View>
  <Text className="ml-auto font-medium">+$99.00</Text>
      </View>
      <View className="flex items-center">
        <Avatar className="h-9 w-9">
          <AvatarImage src="/placeholder.svg?height=36&width=36" alt="Avatar" />
          <AvatarFallback>SD</AvatarFallback>
        </Avatar>
        <View className="ml-4 space-y-1">
          <Text className="text-sm font-medium leading-none">Sofia Davis</Text>
          <Text className="text-sm text-muted-foreground">sofia.davis@email.com</Text>
        </View>
  <Text className="ml-auto font-medium">+$39.00</Text>
      </View>
    </View>
  )
}
