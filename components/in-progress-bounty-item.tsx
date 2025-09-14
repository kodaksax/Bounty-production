import { Avatar, AvatarFallback, AvatarImage } from "components/ui/avatar"

interface InProgressBountyItemProps {
  username: string
  title: string
  amount: number
  distance: number
  timeAgo: string
  avatarSrc?: string
}

export function InProgressBountyItem({
  username,
  title,
  amount,
  distance,
  timeAgo,
  avatarSrc,
}: InProgressBountyItemProps) {
  return (
    <div className="bg-emerald-800/50 backdrop-blur-sm rounded-lg overflow-hidden mb-3">
      <div className="p-3">
        <div className="flex items-center gap-3">
          <Avatar className="h-8 w-8 border border-emerald-400/30">
            <AvatarImage src={avatarSrc || "/placeholder.svg?height=32&width=32"} alt={username} />
            <AvatarFallback className="bg-emerald-900 text-emerald-200 text-xs">
              {username.substring(1, 3).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1">
            <div className="flex justify-between items-center">
              <span className="text-sm text-emerald-100">{username}</span>
              <span className="text-xs text-emerald-300">{timeAgo}</span>
            </div>
            <p className="text-white font-medium mt-0.5">{title}</p>
          </div>
        </div>

        <div className="flex justify-between items-center mt-2">
          <div className="bg-emerald-900/50 px-2 py-1 rounded text-emerald-400 font-bold text-sm">${amount}</div>
          <div className="text-sm text-emerald-200">{distance} mi</div>
        </div>
      </div>
    </div>
  )
}
