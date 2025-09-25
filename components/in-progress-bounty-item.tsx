import { Avatar, AvatarFallback, AvatarImage } from "components/ui/avatar"
import { Text, View } from "react-native"

interface InProgressBountyItemProps {
  username: string
  title: string
  amount: number
  distance: number
  timeAgo: string
  avatarSrc?: string
  workType?: 'online' | 'in_person'
}

export function InProgressBountyItem({
  username,
  title,
  amount,
  distance,
  timeAgo,
  avatarSrc,
  workType,
}: InProgressBountyItemProps) {
  return (
    <View className="bg-emerald-800/50 backdrop-blur-sm rounded-lg overflow-hidden mb-3">
      <View className="p-3">
        <View className="flex items-center gap-3">
          <Avatar className="h-8 w-8 border border-emerald-400/30">
            <AvatarImage src={avatarSrc || "/placeholder.svg?height=32&width=32"} alt={username} />
            <AvatarFallback className="bg-emerald-900 text-emerald-200 text-xs">
              {username.substring(1, 3).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <View className="flex-1">
            <View className="flex justify-between items-center">
              <Text className="text-sm text-emerald-100">{username}</Text>
              <Text className="text-xs text-emerald-300">{timeAgo}</Text>
            </View>
            <Text className="text-white font-medium mt-0.5">{title}</Text>
          </View>
        </View>

        <View className="flex-row justify-between items-center mt-2">
          <View className="flex-row items-center gap-2">
            <View className="bg-emerald-900/50 px-2 py-1 rounded">
              <Text className="text-emerald-400 font-bold text-xs">${amount}</Text>
            </View>
            {workType && (
              <View className="bg-emerald-700/40 px-2 py-1 rounded">
                <Text className="text-emerald-200 text-[10px] tracking-wide uppercase">{workType === 'online' ? 'Online' : 'In Person'}</Text>
              </View>
            )}
          </View>
          <Text className="text-sm text-emerald-200">{distance} mi</Text>
        </View>
      </View>
    </View>
  )
}
