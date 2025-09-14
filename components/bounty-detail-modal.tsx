"use client"

import { useState, useRef, useEffect } from "react"
import { Avatar, AvatarFallback, AvatarImage } from "components/ui/avatar"
import { ArrowLeft, Paperclip, Send, X, FileText, ImageIcon, Target } from "lucide-react"
import { cn } from "lib/utils"

interface BountyDetailModalProps {
  bounty: {
    id: number
    username: string
    title: string
    price: number
    distance: number
    description?: string
    attachments?: {
      id: string
      type: "image" | "document"
      name: string
      size: string
    }[]
  }
  onClose: () => void
}

interface Message {
  id: string
  sender: "user" | "other"
  text: string
  timestamp: Date
}

export function BountyDetailModal({ bounty, onClose }: BountyDetailModalProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [newMessage, setNewMessage] = useState("")
  const [isClosing, setIsClosing] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const modalRef = useRef<HTMLDivElement>(null)

  // Sample description if not provided
  const description =
    bounty.description ||
    "I need someone to mow my lawn. The yard is approximately 1/4 acre with some slopes. I have a lawn mower you can use, or you can bring your own equipment. The grass is about 3 inches tall now. Please trim around the edges and clean up afterward. This should take about 2 hours to complete. I need this done by this weekend."

  // Sample attachments if not provided
  const attachments = bounty.attachments || [
    { id: "1", type: "image", name: "yard-front.jpg", size: "2.4 MB" },
    { id: "2", type: "document", name: "lawn-instructions.pdf", size: "1.1 MB" },
  ]

  // Handle close animation
  const handleClose = () => {
    setIsClosing(true)
    setTimeout(() => {
      onClose()
    }, 300)
  }

  // Scroll to bottom of messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  // Handle click outside to close
  // In React Native, use TouchableWithoutFeedback for click outside modal.

  // Send message
  const handleSendMessage = () => {
    if (newMessage.trim() === "") return

    const newMsg: Message = {
      id: Date.now().toString(),
      sender: "user",
      text: newMessage,
      timestamp: new Date(),
    }

    setMessages([...messages, newMsg])
    setNewMessage("")

    // Simulate response after 1 second
    setTimeout(() => {
      const response: Message = {
        id: (Date.now() + 1).toString(),
        sender: "other",
        text: "Thanks for your interest! Do you have any specific questions about the bounty?",
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, response])
    }, 1000)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div
        ref={modalRef}
        className={cn(
          "relative w-full h-[90vh] flex flex-col bg-emerald-600 rounded-t-3xl rounded-b-3xl overflow-hidden transition-all duration-300 transform",
          isClosing ? "translate-y-full opacity-0" : "translate-y-0 opacity-100",
        )}
      >
        {/* Header - iPhone optimized */}
        <div className="flex items-center justify-between p-4 pt-safe bg-emerald-700">
          <div className="flex items-center">
            <Target className="h-5 w-5 mr-2 text-white" />
            <span className="text-lg font-bold tracking-wider text-white">BOUNTY</span>
          </div>
          <button onClick={handleClose} className="text-white p-2 touch-target-min">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Bounty Details - Scrollable content */}
        <div className="flex-1 overflow-y-auto ios-scroll p-4 bg-emerald-600">
          <div className="bg-emerald-700/80 rounded-xl overflow-hidden mb-4">
            <div className="p-4">
              {/* User info */}
              <div className="flex items-center gap-3 mb-3">
                <Avatar className="h-10 w-10 border border-emerald-400/30">
                  <AvatarImage src="/placeholder.svg?height=40&width=40" alt={bounty.username} />
                  <AvatarFallback className="bg-emerald-900 text-emerald-200 text-xs">
                    {bounty.username.substring(1, 3).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <div className="text-sm text-emerald-100">{bounty.username}</div>
                  <div className="text-xs text-emerald-300">Posted 2h ago</div>
                </div>
              </div>

              {/* Title */}
              <h2 className="text-xl font-bold text-white mb-3">{bounty.title}</h2>

              {/* Price and distance */}
              <div className="flex justify-between items-center mb-4">
                <div className="bg-emerald-900/50 px-3 py-1.5 rounded-lg text-emerald-400 font-bold">
                  ${bounty.price}
                </div>
                <div className="text-sm text-emerald-200">{bounty.distance} mi away</div>
              </div>

              {/* Description */}
              <div className="mb-4">
                <h3 className="text-sm font-medium text-emerald-200 mb-1">Description</h3>
                <p className="text-white text-sm">{description}</p>
              </div>

              {/* Attachments */}
              {attachments.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-emerald-200 mb-2">Attachments</h3>
                  <div className="space-y-2">
                    {attachments.map((attachment) => (
                      <div key={attachment.id} className="flex items-center bg-emerald-800/50 p-3 rounded-lg">
                        <div className="h-10 w-10 rounded-md bg-emerald-900 flex items-center justify-center mr-3">
                          {attachment.type === "image" ? (
                            <ImageIcon className="h-5 w-5 text-emerald-300" />
                          ) : (
                            <FileText className="h-5 w-5 text-emerald-300" />
                          )}
                        </div>
                        <div className="flex-1">
                          <div className="text-sm text-white">{attachment.name}</div>
                          <div className="text-xs text-emerald-300">{attachment.size}</div>
                        </div>
                        <button className="text-emerald-300 hover:text-white transition-colors p-2 touch-target-min">
                          <ArrowLeft className="h-4 w-4 rotate-180" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Messages */}
          <div className="mb-4">
            <h3 className="text-sm font-medium text-emerald-200 mb-2">Messages</h3>

            {messages.length === 0 ? (
              <div className="text-center py-6 text-emerald-300 text-sm">No messages yet. Start the conversation!</div>
            ) : (
              <div className="space-y-3">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={cn(
                      "max-w-[80%] p-3 rounded-lg",
                      message.sender === "user"
                        ? "bg-emerald-500 text-white ml-auto rounded-br-none"
                        : "bg-emerald-700 text-white rounded-bl-none",
                    )}
                  >
                    <p className="text-sm">{message.text}</p>
                    <div className="text-right mt-1">
                      <span className="text-xs opacity-70">
                        {message.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>
        </div>

        {/* Message Input - Fixed at bottom with safe area inset */}
        <div className="p-3 bg-emerald-700 border-t border-emerald-600">
          <div className="flex items-center gap-2">
            <button className="text-emerald-300 hover:text-white transition-colors p-2 touch-target-min">
              <Paperclip className="h-5 w-5" />
            </button>
            <input
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSendMessage()
              }}
              placeholder="Message about this bounty..."
              className="flex-1 bg-emerald-800/50 border-none rounded-full py-3 px-4 text-white placeholder:text-emerald-300/70 focus:outline-none focus:ring-1 focus:ring-emerald-400"
            />
            <button
              onClick={handleSendMessage}
              disabled={newMessage.trim() === ""}
              className={cn(
                "h-12 w-12 rounded-full flex items-center justify-center transition-colors touch-target-min",
                newMessage.trim() === ""
                  ? "bg-emerald-800/50 text-emerald-300/50"
                  : "bg-emerald-500 text-white hover:bg-emerald-400",
              )}
            >
              <Send className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Accept Bounty Button - With safe area inset */}
        <div className="p-3 pt-0 bg-emerald-700 pb-safe">
          <button className="w-full py-3 bg-emerald-500 hover:bg-emerald-400 transition-colors rounded-lg text-white font-medium touch-target-min">
            Accept Bounty
          </button>
        </div>
      </div>
    </div>
  )
}
