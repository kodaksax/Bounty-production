"use client"

import { CreateBountyFlow } from "app/screens/CreateBounty"
import * as React from "react"
import { useState } from "react"
import { View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { getBottomNavContentPadding } from "../../lib/constants/navigation"
import { useAppThemeContext } from "../../lib/themes/AppThemeContext"

interface NeedHelpScreenProps {
  activeScreen: string
  setActiveScreen: (screen: string) => void
  onBountyPosted?: () => void // Callback when a bounty is successfully posted
  setShowBottomNav?: (show: boolean) => void
}

/**
 * NeedHelpScreen — the "Need Help" bottom-nav tab.
 *
 * Hosts only the post-a-bounty workflow. All creation behavior (draft
 * persistence, attachments, location, schedule, compensation, escrow funding
 * and publish) lives in CreateBountyFlow — this screen is just its shell. The
 * flow owns the full screen so its progress bar sits at the top, matching the
 * design; there is deliberately no branding/wallet header here.
 */
export function NeedHelpScreen({ activeScreen, setActiveScreen, onBountyPosted, setShowBottomNav }: NeedHelpScreenProps) {
  const insets = useSafeAreaInsets()
  const { theme } = useAppThemeContext()

  // Bumping this remounts CreateBountyFlow so exiting the flow resets it to
  // step 1 instead of dropping the poster back where they left off.
  const [flowKey, setFlowKey] = useState(0)

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.background,
        paddingTop: insets.top,
        // The flow owns its own CTA spacing, so this screen only clears the
        // shared BottomNav itself and does not add the extra 16px list gap.
        paddingBottom: getBottomNavContentPadding(insets.bottom, 0),
      }}
    >
      <CreateBountyFlow
        key={flowKey}
        onComplete={() => {
          // After creation, go to the main feed and refresh the public list
          setShowBottomNav?.(true)
          setActiveScreen('bounty')
          onBountyPosted?.()
          setFlowKey((k) => k + 1)
        }}
        onCancel={() => {
          // Exit the flow: return to the feed, show nav, reset to step 1
          setShowBottomNav?.(true)
          setActiveScreen('bounty')
          setFlowKey((k) => k + 1)
        }}
        onStepChange={() => {
          // Keep BottomNav visible on all steps
          setShowBottomNav?.(true)
        }}
      />
    </View>
  )
}

export default NeedHelpScreen
