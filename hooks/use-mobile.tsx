import * as React from "react"
import { Dimensions } from "react-native"

const MOBILE_BREAKPOINT = 768

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState(() => {
    const { width } = Dimensions.get("window")
    return width < MOBILE_BREAKPOINT
  })

  React.useEffect(() => {
    const onChange = ({ window }: { window: { width: number } }) => {
      setIsMobile(window.width < MOBILE_BREAKPOINT)
    }
    const subscription = Dimensions.addEventListener("change", onChange)
    return () => {
      if (typeof subscription?.remove === "function") {
        subscription.remove()
      }
    }
  }, [])

  return isMobile
}
