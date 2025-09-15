"use client"

import { useState } from "react"
import { View, Text, TouchableOpacity, ScrollView } from "react-native"
import { Target, Check, Search, Phone, Camera, User, MessageSquare } from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "components/ui/avatar"
import { cn } from "lib/utils"
import { ChatDetailScreen } from "./chat-detail-screen"

export interface Conversation {
  id: string
  name: string
  avatar?: string
  lastMessage: string
  time: string
  unread: number
  isTyping?: boolean
  isGroup?: boolean
  isRead?: boolean
  status?: string
}

export function MessengerScreen() {
  const [conversations, setConversations] = useState<Conversation[]>([
    {
      id: "1",
      name: "Olivia Grant",
      avatar: "/placeholder.svg?height=40&width=40",
      lastMessage: "Olivia is typing...",
      time: "12:30",
      unread: 3,
      isTyping: true,
      status: "Online now",
    },
    {
      id: "2",
      name: "Product design",
      lastMessage: "When is the meeting scheduled ?",
      time: "12:34",
      unread: 2,
      isGroup: true,
      status: "5 members",
    },
    {
      id: "3",
      name: "John Alfaro",
      avatar: "/placeholder.svg?height=40&width=40",
      lastMessage: "Nice work, I love it 👍",
      time: "12:30",
      unread: 0,
      isRead: true,
      status: "Last seen today",
    },
    {
      id: "4",
      name: "Travis Colwell",
      avatar: "/placeholder.svg?height=40&width=40",
      lastMessage: "Unfortunately, I won't be here today...",
      time: "11:30",
      unread: 0,
      isRead: true,
      status: "Last seen yesterday",
    },
    {
      id: "5",
      name: "Darcy Hooper",
      avatar: "/placeholder.svg?height=40&width=40",
      lastMessage: "Hi! How are you doing ?",
      time: "Yesterday",
      unread: 0,
      isRead: true,
      status: "Last seen 2 days ago",
    },
  ])

  const [activeConversation, setActiveConversation] = useState<string | null>(null)

  const handleConversationClick = (id: string) => {
    // Mark conversation as read
    setConversations((prev) => prev.map((conv) => (conv.id === id ? { ...conv, unread: 0, isRead: true } : conv)))
    setActiveConversation(id)
  }

  const handleBackToInbox = () => {
    setActiveConversation(null)
  }

  if (activeConversation) {
    const conversation = conversations.find((c) => c.id === activeConversation)
    if (conversation) {
      return <ChatDetailScreen conversation={conversation} onBack={handleBackToInbox} />
    }
  }

  return (
    <View className="flex flex-col min-h-screen bg-emerald-600 text-white">
      {/* Header */}
      <View className="p-4 pt-8 pb-2">
        <View className="flex justify-between items-center">
          <View className="flex items-center">
            <Target className="h-5 w-5 mr-2" />
            <Text className="text-lg font-bold tracking-wider">BOUNTY</Text>
          </View>
          <Text className="text-lg font-bold">$ 40.00</Text>
        </View>
        <View className="h-px bg-emerald-500/50 my-2"></View>
      </View>

      {/* Inbox Header */}
      <View className="px-4 py-2 flex justify-between items-center">
        <Text className="text-xl font-bold">INBOX</Text>
        <View className="flex gap-4">
          <TouchableOpacity className="text-sm">Edit</TouchableOpacity>
          <TouchableOpacity className="text-sm flex items-center">New Group</TouchableOpacity>
        </View>
      </View>

      {/* Conversation List */}
      <View className="flex-1 px-2 overflow-y-auto">
        {conversations.map((conversation) => (
          <ConversationItem
            key={conversation.id}
            conversation={conversation}
            onPress={() => handleConversationClick(conversation.id)}
          />
        ))}
      </View>

      {/* Bottom Navigation */}
      <View className="flex justify-around items-center p-4 bg-emerald-700/50">
        <TouchableOpacity className="flex flex-col items-center text-white">
          <MessageSquare className="h-6 w-6" />
          <Text className="text-xs mt-1">Chats</Text>
        </TouchableOpacity>
        <TouchableOpacity className="flex flex-col items-center text-white/60">
          <Phone className="h-6 w-6" />
          <Text className="text-xs mt-1">Calls</Text>
        </TouchableOpacity>
        <TouchableOpacity className="flex flex-col items-center text-white/60">
          <Camera className="h-6 w-6" />
          <Text className="text-xs mt-1">Camera</Text>
        </TouchableOpacity>
        <TouchableOpacity className="flex flex-col items-center text-white/60">
          <Search className="h-6 w-6" />
          <Text className="text-xs mt-1">Search</Text>
        </TouchableOpacity>
        <TouchableOpacity className="flex flex-col items-center text-white/60">
          <User className="h-6 w-6" />
          <Text className="text-xs mt-1">Profile</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

interface ConversationItemProps {
  conversation: Conversation
  onClick: () => void
}

function ConversationItem({ conversation, onClick }: ConversationItemProps) {
  return (
    <View className="flex items-center p-3 hover:bg-emerald-700/30 rounded-lg cursor-pointer" onPress={onClick}>
      <View className="relative">
        {conversation.isGroup ? (
          <GroupAvatar />
        ) : (
          <Avatar className="h-12 w-12">
            <AvatarImage src={conversation.avatar} alt={conversation.name} />
            <AvatarFallback className="bg-emerald-700 text-emerald-200">
              {conversation.name.substring(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        )}
      </View>

      <View className="ml-3 flex-1 min-w-0">
        <View className="flex justify-between items-center">
          <Text className="font-medium">{conversation.name}</Text>
          <Text className="text-xs text-emerald-300">{conversation.time}</Text>
        </View>
        <View className="flex justify-between items-center mt-1">
          <p
            className={cn(
              "text-sm truncate max-w-[200px]",
              conversation.isTyping ? "text-emerald-300" : "text-emerald-200",
            )}
          >
            {conversation.lastMessage}
          </Text>
          {conversation.unread > 0 ? (
            <View className="bg-blue-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center">
              {conversation.unread}
            </View>
          ) : conversation.isRead ? (
            <Check className="h-4 w-4 text-emerald-300" />
          ) : null}
        </View>
      </View>
    </View>
  )
}

function GroupAvatar() {
  return (
    <View className="relative h-12 w-12">
      <View className="absolute top-0 left-0 h-8 w-8 rounded-full bg-emerald-700 border-2 border-emerald-600 flex items-center justify-center overflow-hidden">
        <Avatar className="h-full w-full">
          <AvatarImage src="/placeholder.svg?height=32&width=32" alt="Member 1" />
          <AvatarFallback className="bg-emerald-800 text-emerald-200 text-xs">M1</AvatarFallback>
        </Avatar>
      </View>
      <View className="absolute top-1 right-0 h-8 w-8 rounded-full bg-emerald-700 border-2 border-emerald-600 flex items-center justify-center overflow-hidden">
        <Avatar className="h-full w-full">
          <AvatarImage src="/placeholder.svg?height=32&width=32" alt="Member 2" />
          <AvatarFallback className="bg-emerald-800 text-emerald-200 text-xs">M2</AvatarFallback>
        </Avatar>
      </View>
      <View className="absolute bottom-0 left-1 h-8 w-8 rounded-full bg-emerald-700 border-2 border-emerald-600 flex items-center justify-center overflow-hidden">
        <Avatar className="h-full w-full">
          <AvatarImage src="/placeholder.svg?height=32&width=32" alt="Member 3" />
          <AvatarFallback className="bg-emerald-800 text-emerald-200 text-xs">M3</AvatarFallback>
        </Avatar>
      </View>
    </View>
  )
}
