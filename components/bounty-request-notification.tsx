"use client"

import { Avatar, AvatarFallback, AvatarImage } from "components/ui/avatar"
import { Check, X } from "lucide-react"

interface BountyRequestNotificationProps {
  username: string
  avatarSrc?: string
  onAccept?: () => void
  onReject?: () => void
}

export function BountyRequestNotification({ username, avatarSrc, onAccept, onReject }: BountyRequestNotificationProps) {
  return (
    <div className="bg-emerald-700/40 backdrop-blur-sm rounded-lg overflow-hidden mb-3 p-3">
      <div className="flex items-center gap-3">
        <Avatar className="h-10 w-10 border border-emerald-400/30">
          <AvatarImage src={avatarSrc || "/placeholder.svg?height=40&width=40"} alt={username} />
          <AvatarFallback className="bg-emerald-900 text-emerald-200 text-xs">
            {username.substring(1, 3).toUpperCase()}
          </AvatarFallback>
        </Avatar>

        <div className="flex-1">
          <p className="text-white">
            <span className="font-medium">{username}</span> has requested the privilege of your bounty
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onAccept}
            className="h-8 w-8 rounded-full bg-emerald-500 flex items-center justify-center hover:bg-emerald-400 transition-colors"
          >
            <Check className="h-5 w-5 text-white" />
          </button>
          <button
            onClick={onReject}
            className="h-8 w-8 rounded-full bg-red-500/70 flex items-center justify-center hover:bg-red-400/70 transition-colors"
          >
            <X className="h-5 w-5 text-white" />
          </button>
        </div>
      </div>
    </div>
  )
}
