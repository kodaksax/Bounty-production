import * as React from 'react'
import { View } from 'react-native'

/**
 * RN-friendly Slot stub (Radix substitute)
 * - Merges given props into its single child (if valid React element)
 * - Forwards ref where possible
 * - Provides a fallback wrapper if child is not a valid element (avoids runtime undefined errors)
 * - Adds a development warning once if an invalid child is encountered
 */
let hasWarnedInvalid = false

const Slot = React.forwardRef<any, any>(({ children, ...slotProps }, ref) => {
  if (!React.isValidElement(children)) {
    if (__DEV__ && !hasWarnedInvalid) {
      console.warn('[Slot stub] Invalid child provided to <Slot>; rendering empty View as fallback.')
      hasWarnedInvalid = true
    }
    return <View ref={ref} />
  }

  // Try to preserve existing ref if present
  const existingRef: any = (children as any).ref
  const composedRef = (node: any) => {
    if (typeof existingRef === 'function') existingRef(node)
    else if (existingRef && typeof existingRef === 'object') existingRef.current = node
    if (typeof ref === 'function') ref(node)
    else if (ref && typeof ref === 'object') (ref as any).current = node
  }

  return React.cloneElement(children as any, { ...slotProps, ref: composedRef })
})

Slot.displayName = 'Slot'

export default Slot
