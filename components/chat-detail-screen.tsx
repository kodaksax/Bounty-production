"use client"

import React, { useState } from "react"
import { Text, TouchableOpacity, View } from "react-native"

import { MaterialIcons } from "@expo/vector-icons"
import { Avatar, AvatarFallback, AvatarImage } from "components/ui/avatar"
import { useRouter } from "expo-router"
import type { Conversation } from "lib/types"
import { CURRENT_USER_ID } from "lib/utils/data-utils"
import { useWallet } from '../lib/wallet-context'
import { ChatMessage, StickyMessageInterface } from "./sticky-message-interface"

interface Message extends ChatMessage {
  time: string
  isAudio?: boolean
  audioDuration?: string
}

interface ChatDetailScreenProps {
  conversation: Conversation
  onBack?: () => void
  onNavigate?: (screen?: string) => void
}

// Generate random conversations for each contact
const getConversationMessages = (conversationId: string): Message[] => {
  const base = Date.now() - 1000 * 60 * 60 // start an hour ago
  let idx = 0
  const nextTime = () => base + idx++ * 1000 * 60 * 3 // 3 min increments
  const conversations: Record<string, Message[]> = {
    "1": [
      { id: "1-1", text: "Hey, how are you?", time: "12:10", isUser: true, createdAt: nextTime() },
      { id: "1-2", text: "What are you doing tonight?", time: "12:10", isUser: true, createdAt: nextTime() },
      { id: "1-3", text: "", time: "12:12", isUser: false, isAudio: true, audioDuration: "00:35", createdAt: nextTime() },
      { id: "1-4", text: "I was thinking of going to a local comedy club. Do you have any recommendations?", time: "12:15", isUser: true, createdAt: nextTime() },
      { id: "1-5", text: '"The Laugh Lounge" is known for its hilarious stand-up acts. You should check it out!', time: "12:16", isUser: false, createdAt: nextTime() },
      { id: "1-6", text: "Sounds great! I'll see if any tickets are available.", time: "12:15", isUser: true, createdAt: nextTime() },
    ],
    "2": [
      { id: "2-1", text: "When is the next design review?", time: "10:30", isUser: true, createdAt: nextTime() },
      { id: "2-2", text: "Tomorrow at 2pm", time: "10:35", isUser: false, createdAt: nextTime() },
      { id: "2-3", text: "Can we go through the wireframes first?", time: "10:40", isUser: false, createdAt: nextTime() },
      { id: "2-4", text: "Yes, I'll prepare them tonight", time: "10:45", isUser: true, createdAt: nextTime() },
      { id: "2-5", text: "When is the meeting scheduled?", time: "12:34", isUser: false, createdAt: nextTime() },
    ],
    "3": [
      { id: "3-1", text: "I just finished the project", time: "11:20", isUser: true, createdAt: nextTime() },
      { id: "3-2", text: "Can you take a look?", time: "11:21", isUser: true, createdAt: nextTime() },
      { id: "3-3", text: "Sure, send it over", time: "11:25", isUser: false, createdAt: nextTime() },
      { id: "3-4", text: "Just emailed you the files", time: "11:30", isUser: true, createdAt: nextTime() },
      { id: "3-5", text: "Nice work, I love it 👍", time: "12:30", isUser: false, createdAt: nextTime() },
    ],
    "4": [
      { id: "4-1", text: "Are we still meeting today?", time: "10:15", isUser: true, createdAt: nextTime() },
      { id: "4-2", text: "Unfortunately, I won't be here today...", time: "11:30", isUser: false, createdAt: nextTime() },
      { id: "4-3", text: "No problem, we can reschedule", time: "11:32", isUser: true, createdAt: nextTime() },
      { id: "4-4", text: "How about next Monday?", time: "11:33", isUser: true, createdAt: nextTime() },
      { id: "4-5", text: "That works for me", time: "11:40", isUser: false, createdAt: nextTime() },
    ],
    "5": [
      { id: "5-1", text: "Hi! How are you doing?", time: "Yesterday", isUser: false, createdAt: nextTime() - 86400000 },
      { id: "5-2", text: "I'm good, thanks! How about you?", time: "Yesterday", isUser: true, createdAt: nextTime() - 86400000 },
      { id: "5-3", text: "Great! Just busy with work", time: "Yesterday", isUser: false, createdAt: nextTime() - 86400000 },
      { id: "5-4", text: "Same here. Let's catch up soon", time: "Yesterday", isUser: true, createdAt: nextTime() - 86400000 },
      { id: "5-5", text: "Definitely!", time: "Yesterday", isUser: false, createdAt: nextTime() - 86400000 },
    ],
  }
  return conversations[conversationId] || []
}

export function ChatDetailScreen({
  conversation,
  onBack,
  onNavigate,
}: ChatDetailScreenProps) {
  const router = useRouter()
  const [messages, setMessages] = useState<Message[]>(() => getConversationMessages(conversation.id))
  const { balance } = useWallet()
  // no manual scroll ref needed; handled by StickyMessageInterface
  
  // Get the other participant's ID (not the current user)
  const otherUserId = conversation.participantIds?.find(id => id !== CURRENT_USER_ID)

  const handleSendMessage = (text: string) => {
    const newMsg: Message = {
      id: `${conversation.id}-${Date.now()}`,
      text,
      createdAt: Date.now(),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isUser: true,
    }
    setMessages(prev => [...prev, newMsg])
    // Simulated bot reply
    setTimeout(()=>{
      let responseText = ''
      const lower = text.toLowerCase()
      if (/[?]/.test(lower)) responseText = 'Let me check on that and circle back.'
      else if (lower.includes('hello')|| lower.includes('hi')) responseText = 'Hey! Need help with a bounty?'
      else responseText = 'Acknowledged.'
      const response: Message = {
        id: `${conversation.id}-${Date.now()+1}`,
        text: responseText,
        createdAt: Date.now()+1,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        isUser: false,
      }
      setMessages(prev => [...prev, response])
    }, 900)
  }

  return (
    <View className="flex flex-col h-screen bg-emerald-600 text-white">
      {/* Header */}
      <View className="p-4 pt-8 pb-2">
        <View className="flex-row justify-between items-center">
          <View className="flex-row items-center">
            <MaterialIcons name="gps-fixed" size={24} color="#000000" />
            <Text className="text-lg font-bold tracking-wider ml-2 text-white">BOUNTY</Text>
          </View>
          <Text className="text-lg font-bold">$ {balance.toFixed(2)}</Text>
        </View>
        <View className="h-px bg-emerald-500/50 my-2" />
      </View>

      {/* Chat Header */}
      <View className="px-4 py-2 flex-row items-center justify-between">
        <View className="flex-row items-center">
          <TouchableOpacity
  onPress={() => {
    // exit conversation first if possible
    if (typeof onBack === 'function') {
      onBack()
      return
    }
    if (typeof onNavigate === 'function') {
      onNavigate('create')
    }
  }}
  className="mr-1 p-2 touch-target-min"
>
  <MaterialIcons name="arrow-back" size={24} color="#000000" />
</TouchableOpacity>
          <TouchableOpacity 
            className="flex-row items-center"
            onPress={() => {
              if (otherUserId) {
                router.push(`/profile/${otherUserId}`)
              }
            }}
            disabled={!otherUserId}
          >
            <Avatar className="h-10 w-10 mr-2">
              <AvatarImage src={conversation.avatar} alt={conversation.name} />
              <AvatarFallback className="bg-emerald-700 text-emerald-200">
                {conversation.name.substring(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <View>
              <Text className="font-medium">{conversation.name}</Text>
              
            </View>
          </TouchableOpacity>
        </View>
        <View className="flex-row gap-3">
          <TouchableOpacity className="text-white">
            <MaterialIcons name="phone" size={24} color="#000000" />
          </TouchableOpacity>
          <TouchableOpacity className="text-white">
            <MaterialIcons name="videocam" size={24} color="#000000" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Messages + Sticky Composer */}
      <View className="flex-1">
        <StickyMessageInterface
          messages={messages.map(m => ({ id: m.id, text: m.text, isUser: m.isUser, createdAt: m.createdAt }))}
          onSend={handleSendMessage}
          topInset={120} // offset for combined header + chat header so first message isn't hidden
          bottomInset={0}
          placeholder="Message"
        />
      </View>
    </View>
  )
}

// Removed legacy audio visualization & unused playback code.
