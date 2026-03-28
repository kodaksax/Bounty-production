import React, { useEffect, useState } from 'react'
import {
  View,
  Text,
  FlatList,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native'
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native'

// 🔹 Define types for navigation params
type FollowersScreenRouteParams = {
  FollowersScreen: {
    userId: string
    username?: string
  }
}

// 🔹 Define follower shape (adjust based on your DB)
type Follower = {
  follower_id: string
  profiles: {
    id: string
    username: string
    display_name?: string
    avatar_url?: string
  }
}

// ✅ Corrected component name
const FollowersExpanded: React.FC = () => {
  const navigation = useNavigation()
  const route =
    useRoute<RouteProp<FollowersScreenRouteParams, 'FollowersScreen'>>()

  const { userId, username } = route.params

  const [followers, setFollowers] = useState<Follower[]>([])
  const [loading, setLoading] = useState<boolean>(true)

  useEffect(() => {
    fetchFollowers()
  }, [])

  const fetchFollowers = async () => {
    try {
      // TODO: Replace with your Supabase query
      // const { data, error } = await supabase...

      // TEMP mock
      const mockData: Follower[] = []

      setFollowers(mockData)
    } catch (error) {
      console.error('Error fetching followers:', error)
    } finally {
      setLoading(false)
    }
  }

  const renderItem = ({ item }: { item: Follower }) => {
    const user = item.profiles

    return (
      <TouchableOpacity
        className="py-3 border-b border-emerald-700"
        onPress={() =>
          navigation.navigate('ProfileScreen' as never, {
            userId: user.id,
          } as never)
        }
      >
        <Text className="text-white font-semibold">
          {user.display_name || user.username}
        </Text>
        <Text className="text-emerald-300 text-sm">
          @{user.username}
        </Text>
      </TouchableOpacity>
    )
  }

  if (loading) {
    return <ActivityIndicator style={{ marginTop: 50 }} />
  }

  return (
    <View className="flex-1 bg-emerald-900 p-4">
      <Text className="text-xl font-bold text-white mb-4">
        {username ? `${username}'s Followers` : 'Followers'}
      </Text>

      {followers.length === 0 ? (
        <Text className="text-emerald-300 text-center mt-10">
          No followers yet
        </Text>
      ) : (
        <FlatList
          data={followers}
          keyExtractor={(item) => item.follower_id}
          renderItem={renderItem}
        />
      )}
    </View>
  )
}

export default FollowersExpanded