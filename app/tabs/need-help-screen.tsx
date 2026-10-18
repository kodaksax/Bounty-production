"use client"

import { CreateBountyFlow } from "app/screens/CreateBounty"
import * as React from "react"
import { useEffect, useRef, useState } from "react"
import { View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { getBottomNavBaseClearance } from "../../lib/constants/navigation"
import { useAppThemeContext } from "../../lib/themes/AppThemeContext"

interface NeedHelpScreenProps {
  activeScreen: string
  setActiveScreen: (screen: string) => void
  onBountyPosted?: () => void // Callback when a bounty is successfully posted
  setShowBottomNav?: (show: boolean) => void
  /**
   * Whether the Post tab is the settled, on-screen tab. The tab shell keeps
   * this screen mounted off-screen beside Home and Profile so swiping in is
   * instant; while false the flow is inert (see CreateBountyFlow's
   * `isActive`). Defaults to true.
   */
  isActive?: boolean
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
export function NeedHelpScreen({ activeScreen, setActiveScreen, onBountyPosted, setShowBottomNav, isActive = true }: NeedHelpScreenProps) {
  const insets = useSafeAreaInsets()
  const { theme } = useAppThemeContext()

  // Bumping this remounts CreateBountyFlow so leaving the tab — by tab bar,
  // swipe, cancel or publish — resets it to step 1 instead of dropping the
  // poster back where they left off. The shell used to unmount this whole
  // screen on leave; now that it stays mounted as a neighbour, the reset
  // happens here instead. The old flow instance unmounts exactly as it did
  // then, so post_step_abandoned / post_abandoned still fire on leave. It
  // runs once the shell reports the Post tab no longer settled, i.e. after
  // the slide away, so the fresh mount never competes with the animation.
  const [flowKey, setFlowKey] = useState(0)
  const wasActiveRef = useRef(isActive)
  useEffect(() => {
    if (wasActiveRef.current && !isActive) setFlowKey((k) => k + 1)
    wasActiveRef.current = isActive
  }, [isActive])

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.background,
        // No paddingTop: the flow applies it (topInset) so step 1's hero can
        // sit flush under the status-bar strip. The flow owns its own CTA spacing, so this screen only clears the
        // shared BottomNav itself and does not add the extra 16px list gap.
        paddingBottom: getBottomNavBaseClearance(insets.bottom),
      }}
    >
      <CreateBountyFlow
        key={flowKey}
        entryPoint="need_help_tab"
        // Every flow instance here only becomes active when the poster
        // navigates to the Post tab (tab bar, swipe or an in-app CTA), and
        // CreateBountyFlow fires nothing while inactive — so whenever this
        // instance reports anything, a deliberate navigation got the poster
        // here. Instances remounted on leave sit inactive until the next one.
        deliberateTap
        isActive={isActive}
        topInset={insets.top}
        onComplete={() => {
          // After creation, go to the main feed and refresh the public list
          setShowBottomNav?.(true)
          setActiveScreen('bounty')
          onBountyPosted?.()
        }}
        onCancel={() => {
          // Exit the flow: return to the feed and show nav. Leaving the tab
          // resets the flow to step 1 (see flowKey above).
          setShowBottomNav?.(true)
          setActiveScreen('bounty')
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
