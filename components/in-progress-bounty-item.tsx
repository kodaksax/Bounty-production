import { Avatar, AvatarFallback, AvatarImage } from "components/ui/avatar"
import { useRouter } from "expo-router"
import { Text, TouchableOpacity, View } from "react-native"

interface InProgressBountyItemProps {
  bountyId: number | string
  username: string
  title: string
  amount: number
  distance: number
  timeAgo: string
  avatarSrc?: string
  workType?: 'online' | 'in_person'
  isForHonor?: boolean
}

export function InProgressBountyItem({
  bountyId,
  username,
  title,
  amount,
  distance,
  timeAgo,
  avatarSrc,
  workType,
  isForHonor,
}: InProgressBountyItemProps) {
  const router = useRouter()

  const handlePress = () => {
    router.push({
      pathname: '/in-progress/[bountyId]/hunter',
      params: { bountyId: String(bountyId) },
    })
  }

  return (
    <TouchableOpacity onPress={handlePress} activeOpacity={0.7}>
      <View className="bg-[#111827]/50 backdrop-blur-sm rounded-lg overflow-hidden mb-3">
        <View className="p-3">
          <View className="flex items-center gap-3">
            <Avatar className="h-8 w-8 border border-[#059669]/30">
              <AvatarImage src={avatarSrc || "/placeholder.svg?height=32&width=32"} alt={username} />
              <AvatarFallback className="bg-[#0B0F14] text-[#9CA3AF] text-xs">
                {username.substring(1, 3).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <View className="flex-1">
              <View className="flex justify-between items-center">
                <Text className="text-sm text-white">{username}</Text>
                <Text className="text-xs text-[#6ee7b7]">{timeAgo}</Text>
              </View>
              <Text className="text-white font-medium mt-0.5">{title}</Text>
            </View>
          </View>

          <View className="flex-row justify-between items-center mt-2">
            <View className="flex-row items-center gap-2">
              {isForHonor ? (
                <View className="bg-pink-600/80 px-2 py-1 rounded">
                  <Text className="text-white font-bold text-xs">For Honor</Text>
                </View>
              ) : (
                <View className="bg-[#0B0F14]/50 px-2 py-1 rounded">
                  <Text className="text-[#6ee7b7] font-bold text-xs">${amount}</Text>
                </View>
              )}
              {workType && (
                <View className="bg-[#111827] px-2 py-1 rounded">
                  <Text className="text-[#9CA3AF] text-[10px] tracking-wide uppercase">{workType === 'online' ? 'Online' : 'In Person'}</Text>
                </View>
              )}
            </View>
            <Text className="text-sm text-[#9CA3AF]">{distance} mi</Text>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  )
}
