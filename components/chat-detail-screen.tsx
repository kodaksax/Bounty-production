"use client"

import React, { useEffect, useRef, useState } from "react"
import { ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native"

import { MaterialIcons } from "@expo/vector-icons"
import { Avatar, AvatarFallback, AvatarImage } from "components/ui/avatar"
import { cn } from "lib/utils"
import type { Conversation } from "./messenger-screen"

interface Message {
  id: string
  text: string
  time: string
  isUser: boolean
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
  // Predefined conversations for each contact
  const conversations: Record<string, Message[]> = {
    "1": [
      // Olivia Grant
      { id: "1-1", text: "Hey, how are you?", time: "12:10", isUser: true },
      { id: "1-2", text: "What are you doing tonight?", time: "12:10", isUser: true },
      { id: "1-3", text: "", time: "12:12", isUser: false, isAudio: true, audioDuration: "00:35" },
      {
        id: "1-4",
        text: "I was thinking of going to a local comedy club. Do you have any recommendations?",
        time: "12:15",
        isUser: true,
      },
      {
        id: "1-5",
        text: '"The Laugh Lounge" is known for its hilarious stand-up acts. You should check it out!',
        time: "12:16",
        isUser: false,
      },
      { id: "1-6", text: "Sounds great! I'll see if any tickets are available.", time: "12:15", isUser: true },
    ],
    "2": [
      // Product design group
      { id: "2-1", text: "When is the next design review?", time: "10:30", isUser: true },
      { id: "2-2", text: "Tomorrow at 2pm", time: "10:35", isUser: false },
      { id: "2-3", text: "Can we go through the wireframes first?", time: "10:40", isUser: false },
      { id: "2-4", text: "Yes, I'll prepare them tonight", time: "10:45", isUser: true },
      { id: "2-5", text: "When is the meeting scheduled?", time: "12:34", isUser: false },
    ],
    "3": [
      // John Alfaro
      { id: "3-1", text: "I just finished the project", time: "11:20", isUser: true },
      { id: "3-2", text: "Can you take a look?", time: "11:21", isUser: true },
      { id: "3-3", text: "Sure, send it over", time: "11:25", isUser: false },
      { id: "3-4", text: "Just emailed you the files", time: "11:30", isUser: true },
      { id: "3-5", text: "Nice work, I love it 👍", time: "12:30", isUser: false },
    ],
    "4": [
      // Travis Colwell
      { id: "4-1", text: "Are we still meeting today?", time: "10:15", isUser: true },
      { id: "4-2", text: "Unfortunately, I won't be here today...", time: "11:30", isUser: false },
      { id: "4-3", text: "No problem, we can reschedule", time: "11:32", isUser: true },
      { id: "4-4", text: "How about next Monday?", time: "11:33", isUser: true },
      { id: "4-5", text: "That works for me", time: "11:40", isUser: false },
    ],
    "5": [
      // Darcy Hooper
      { id: "5-1", text: "Hi! How are you doing?", time: "Yesterday", isUser: false },
      { id: "5-2", text: "I'm good, thanks! How about you?", time: "Yesterday", isUser: true },
      { id: "5-3", text: "Great! Just busy with work", time: "Yesterday", isUser: false },
      { id: "5-4", text: "Same here. Let's catch up soon", time: "Yesterday", isUser: true },
      { id: "5-5", text: "Definitely!", time: "Yesterday", isUser: false },
    ],
  }

  return conversations[conversationId] || []
}

export function ChatDetailScreen({
  conversation,
  onBack,
  onNavigate,
}: ChatDetailScreenProps) {

  const [messages, setMessages] = useState<Message[]>(() => getConversationMessages(conversation.id))
  const [newMessage, setNewMessage] = useState("")
  const [isAudioPlaying, setIsAudioPlaying] = useState(false)
  const scrollRef = useRef<ScrollView | null>(null)

  // Scroll to bottom when messages change
  useEffect(() => {
    // wait a tick then scroll
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50)
  }, [messages])

  const handleSendMessage = () => {
    if (newMessage.trim() === "") return

    const newMsg: Message = {
      id: `${conversation.id}-${Date.now()}`,
      text: newMessage,
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      isUser: true,
    }

  setMessages((prev) => [...prev, newMsg])
    setNewMessage("")

    // Simulate response after 1-2 seconds for a more realistic feel
    setTimeout(
      () => {
        // Generate a contextual response
        let responseText = ""

        if (newMessage.toLowerCase().includes("hello") || newMessage.toLowerCase().includes("hi")) {
          responseText = "Hi there! How can I help you today?"
        } else if (newMessage.toLowerCase().includes("meeting")) {
          responseText = "I'm available for a meeting tomorrow afternoon. Does that work for you?"
        } else if (newMessage.toLowerCase().includes("thanks") || newMessage.toLowerCase().includes("thank you")) {
          responseText = "You're welcome! 😊"
        } else if (newMessage.toLowerCase().includes("?")) {
          responseText = "That's a good question. Let me think about it and get back to you."
        } else {
          responseText = "Got it! I'll keep that in mind."
        }

        const response: Message = {
          id: `${conversation.id}-${Date.now() + 1}`,
          text: responseText,
          time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          isUser: false,
        }

        setMessages((prev) => [...prev, response])
      },
      Math.random() * 1000 + 1000,
    ) // Random delay between 1-2 seconds
  }

  return (
    <View className="flex flex-col h-screen bg-emerald-600 text-white">
      {/* Header */}
      <View className="p-4 pt-8 pb-2">
        <View className="flex-row justify-between items-center">
          <View className="flex-row items-center">
            <MaterialIcons name="gps-fixed" size={24} color="#000000" />
            <Text className="text-lg font-bold tracking-wider ml-2">BOUNTY</Text>
          </View>
          <Text className="text-lg font-bold">$ 40.00</Text>
        </View>
        <View className="h-px bg-emerald-500/50 my-2" />
      </View>

      {/* Chat Header */}
      <View className="px-4 py-2 flex-row items-center justify-between">
        <View className="flex-row items-center">
          <TouchableOpacity
  onPress={() => {
    // prefer the app-level navigator if provided
    if (typeof onNavigate === 'function') {
      onNavigate('create')   // 'create' maps to Messenger in your BottomNav mapping
    } else if (typeof onBack === 'function') {
      // fall back to any existing handler
      onBack()
    }
  }}
  className="mr-1 p-2 touch-target-min"
>
  <MaterialIcons name="arrow-back" size={24} color="#000000" />
</TouchableOpacity>
          <Avatar className="h-10 w-10 mr-2">
            <AvatarImage src={conversation.avatar} alt={conversation.name} />
            <AvatarFallback className="bg-emerald-700 text-emerald-200">
              {conversation.name.substring(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <View>
            <Text className="font-medium">{conversation.name}</Text>
            <Text className="text-xs text-emerald-300">{conversation.status}</Text>
          </View>
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

      {/* Messages */}
      <ScrollView ref={scrollRef} className="flex-1 p-4">
        {messages.map((message) => (
          <View key={message.id} className={cn("mb-3 max-w-4/5", message.isUser ? "ml-auto" : "mr-auto")}>
            {message.isAudio ? (
              <View className="bg-blue-600 rounded-2xl p-2 flex-row items-center">
                <TouchableOpacity
                  className="h-8 w-8 rounded-full bg-white flex items-center justify-center mr-2"
                  onPress={() => setIsAudioPlaying(!isAudioPlaying)}
                >
                  <MaterialIcons name={isAudioPlaying ? "pause" : "play-arrow"} size={20} color="#1c7ed6" />
                </TouchableOpacity>
                <View className="flex-1 h-6">
                  {/* Simple waveform placeholder */}
                  <View className="flex-row items-center justify-between h-full">
                    {Array.from({ length: 8 }).map((_, i) => (
                      <View key={i} className={cn("w-1 bg-blue-300 rounded-full", isAudioPlaying ? "h-6" : "h-3")} />
                    ))}
                  </View>
                </View>
                <Text className="text-xs text-white ml-2">{message.audioDuration}</Text>
              </View>
            ) : (
              <View
                className={cn(
                  "p-3 rounded-2xl",
                  message.isUser ? "bg-white text-gray-800 rounded-br-none" : "bg-blue-600 text-white rounded-bl-none",
                )}
              >
                <Text className="text-sm">{message.text}</Text>
                <View className={cn("mt-1", message.isUser ? "items-end" : "items-end")}> 
                  <Text className="text-xs">{message.time}</Text>
                </View>
              </View>
            )}
          </View>
        ))}
      </ScrollView>

      {/* Input Area */}
      <View className="p-4 bg-emerald-700/30">
        <View className="flex-row items-center gap-2">
          <TouchableOpacity className="h-10 w-10 rounded-full bg-emerald-700/50 items-center justify-center">
            <MaterialIcons name="add" size={24} color="#000000" />
          </TouchableOpacity>
          <View className="flex-1 bg-emerald-700/50 rounded-full flex-row items-center px-4">
            <TextInput
              value={newMessage}
              onChangeText={setNewMessage}
              placeholder="Message"
              placeholderTextColor="#c7f9d7"
              style={{ flex: 1, backgroundColor: "transparent", paddingVertical: 8, color: "#ffffff" }}
              returnKeyType="send"
              onSubmitEditing={handleSendMessage}
            />
            {newMessage ? (
              <TouchableOpacity onPress={handleSendMessage} className="h-8 w-8 rounded-full bg-emerald-500 items-center justify-center">
                <MaterialIcons name="send" size={20} color="#000000" />
              </TouchableOpacity>
            ) : (
              <>
                <TouchableOpacity className="p-2 text-emerald-300">
                  <MaterialIcons name="photo-camera" size={20} color="#c7f9d7" />
                </TouchableOpacity>
                <TouchableOpacity className="p-2 text-emerald-300">
                  <MaterialIcons name="mic" size={20} color="#c7f9d7" />
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </View>
    </View>
  )
}

// Removed web SVG Play component - using MaterialIcons play/pause instead for React Native

// Audio waveform visualization
function AudioWaveform({ isPlaying }: { isPlaying: boolean }) {
  return (
    <View className="flex flex-row items-center justify-between h-full w-full">
      {Array.from({ length: 20 }).map((_, i) => {
        // Generate random heights for the bars (0-100%)
        const height = Math.round(Math.random() * 100)

        return (
          <View
            key={i}
            className="w-1 bg-blue-300 rounded-full"
            style={{
              height: `${height}%`,
              opacity: isPlaying ? 1 : 0.7,
            }}
          />
        )
      })}
    </View>
  )
}
