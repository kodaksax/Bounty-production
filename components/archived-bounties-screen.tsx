"use client"

import { ArrowLeft, Target } from "lucide-react"
import { ArchivedBountyCard } from "./archived-bounty-card"
import { useState } from "react"

interface ArchivedBountiesScreenProps {
  onBack?: () => void
}

export function ArchivedBountiesScreen({ onBack }: ArchivedBountiesScreenProps) {
  const [archivedBounties] = useState([
    {
      id: "b1e7a3c9d5f2",
      username: "@Jon_Doe",
      title: "Mow My Lawn!!!",
      amount: 600000,
      distance: 10,
    },
    {
      id: "a2c4e6g8i0k2",
      username: "@Jon_Doe",
      title: "Mow My Lawn!!!",
      amount: 600000,
      distance: 10,
    },
    {
      id: "z9y8x7w6v5u4",
      username: "@MtnOlympus",
      title: "Deliver this package",
      amount: 450000,
      distance: 15,
    },
    {
      id: "j1k2l3m4n5o6",
      username: "@CryptoKing",
      title: "Find my lost wallet",
      amount: 1200000,
      distance: 5,
    },
  ])

  return (
    <div className="flex flex-col min-h-screen bg-emerald-600">
      {/* Header */}
      <div className="flex justify-between items-center p-4 pt-8">
        <div className="flex items-center gap-3">
          <Target className="h-5 w-5 text-white" />
          <span className="text-lg font-bold tracking-wider text-white">BOUNTY</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-white font-medium">$ 40.00</span>
        </div>
      </div>

      {/* Title with back button */}
      <div className="px-4 py-2 flex items-center">
        <button onClick={onBack} className="mr-3 text-white">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-white text-xl font-bold tracking-wide uppercase text-center flex-1 mr-5">
          Archived Bounty
        </h1>
      </div>

      {/* NFT Collection */}
      <div className="flex-1 px-4 py-4 overflow-y-auto">
        {archivedBounties.map((bounty) => (
          <ArchivedBountyCard
            key={bounty.id}
            id={bounty.id}
            username={bounty.username}
            title={bounty.title}
            amount={bounty.amount}
            distance={bounty.distance}
            onMenuClick={() => console.log(`Menu clicked for ${bounty.id}`)}
          />
        ))}
      </div>

      {/* Bottom Navigation Indicator */}
      <div className="flex justify-center pb-6">
        <div className="h-1 w-1 rounded-full bg-white/50 mx-1"></div>
        <div className="h-1 w-1 rounded-full bg-white/50 mx-1"></div>
        <div className="h-1 w-1 rounded-full bg-white mx-1"></div>
        <div className="h-1 w-1 rounded-full bg-white/50 mx-1"></div>
        <div className="h-1 w-1 rounded-full bg-white/50 mx-1"></div>
      </div>
    </div>
  )
}
