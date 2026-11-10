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
  /**
   * Where this visit to the Post tab came from, when something other than the
   * tab itself sent the poster here. Becomes the composer's `entry_point`.
   */
  entryPoint?: string
  /**
   * A "Post again" for this visit (lib/post-again/handoff.ts). Its draft is
   * already saved; a new `nonce` remounts the composer so it reads that draft,
   * opening on `startStep`. The remount is the same one leaving the tab does.
   */
  postAgain?: { nonce: number; startStep: 1 | 2 | 3 } | null
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
export function NeedHelpScreen({ activeScreen, setActiveScreen, onBountyPosted, setShowBottomNav, isActive = true, entryPoint = "need_help_tab", postAgain = null }: NeedHelpScreenProps) {
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
  // The Post-again request already used up by an earlier flow instance. The
  // instance a request mounts opens on its step; every one after it (the
  // remount on leaving the tab) starts at step 1 again.
  const [spentPostAgainNonce, setSpentPostAgainNonce] = useState<number | null>(null)
  const postAgainRef = useRef(postAgain)
  postAgainRef.current = postAgain
  const wasActiveRef = useRef(isActive)
  useEffect(() => {
    if (wasActiveRef.current && !isActive) {
      setFlowKey((k) => k + 1)
      setSpentPostAgainNonce(postAgainRef.current?.nonce ?? null)
    }
    wasActiveRef.current = isActive
  }, [isActive])
  // The request's nonce is part of the key, so the remount happens in the same
  // render the request arrives in. Done from an effect instead, the old
  // instance could go active for a render first and log a composer open.
  const livePostAgain = postAgain && postAgain.nonce !== spentPostAgainNonce ? postAgain : null
  const flowInstanceKey = `${flowKey}:${postAgain?.nonce ?? 0}`

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
        key={flowInstanceKey}
        entryPoint={entryPoint}
        startStep={livePostAgain?.startStep}
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
