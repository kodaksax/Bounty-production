"use client"

import { type ReactNode, useState } from "react"
import { MoreVertical } from "lucide-react"
import { BountyDetailModal } from "./bounty-detail-modal"

interface TaskCardProps {
  id: number
  username: string
  title: string
  price: number
  distance: number
  icon?: ReactNode
  description?: string
  highlight?: "price" | "distance" // New prop to highlight either price or distance
}

export function TaskCard({
  id,
  username,
  title,
  price,
  distance,
  icon,
  description,
  highlight = "distance",
}: TaskCardProps) {
  const [showDetail, setShowDetail] = useState(false)

  return (
    <>
      <div
        className="bg-black/30 backdrop-blur-sm rounded-xl overflow-hidden cursor-pointer transition-transform active:scale-[0.98] touch-target-min shadow-md"
        onClick={() => setShowDetail(true)}
      >
        <div className="p-4">
          {/* Header */}
          <div className="flex justify-between items-center mb-2">
            <div className="flex items-center">
              <div className="h-6 w-6 rounded-full bg-gray-700 flex items-center justify-center mr-2">{icon}</div>
              <span className="text-sm text-gray-300">{username}</span>
            </div>
            <button className="p-2 touch-target-min">
              <MoreVertical className="h-5 w-5 text-gray-400" />
            </button>
          </div>

          {/* Title */}
          <h3 className="text-base font-medium mb-3 line-clamp-2">{title}</h3>

          {/* Footer */}
          <div className="flex justify-between items-center">
            <div>
              <div className="text-xs text-gray-400">Total Bounty</div>
              <div className={`font-bold ${highlight === "price" ? "text-yellow-400 text-lg" : "text-yellow-400"}`}>
                ${price}
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-gray-400">Approx. Distance</div>
              <div className={`${highlight === "distance" ? "text-white font-bold" : "text-gray-300"}`}>
                {distance} mi
              </div>
            </div>
          </div>
        </div>
      </div>

      {showDetail && (
        <BountyDetailModal
          bounty={{ id, username, title, price, distance, description }}
          onClose={() => setShowDetail(false)}
        />
      )}
    </>
  )
}
