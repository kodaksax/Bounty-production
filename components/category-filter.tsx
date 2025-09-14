"use client"

import type { ReactNode } from "react"
import { cn } from "lib/utils"

interface CategoryFilterProps {
  label: string
  icon?: ReactNode
  isActive?: boolean
  onClick?: () => void
}

export function CategoryFilter({ label, icon, isActive = false, onClick }: CategoryFilterProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center space-x-2 px-5 py-2.5 rounded-full whitespace-nowrap touch-target-min shadow-sm",
        isActive ? "bg-emerald-800/80 text-white" : "bg-white/20 text-white/90",
      )}
    >
      {icon && <span className="text-lg">{icon}</span>}
      <span className="text-base font-medium">{label}</span>
    </button>
  )
}
