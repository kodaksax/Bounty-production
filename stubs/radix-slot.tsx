import * as React from 'react'

// Minimal Slot implementation for RN: clones the child and merges props.
const Slot = React.forwardRef<any, any>(({ children, ...slotProps }, ref) => {
  if (!React.isValidElement(children)) return null
  // Merge slotProps into the child. Forwarding ref to arbitrary children can
  // be tricky; most call sites only need prop merging, so we omit ref here.
  return React.cloneElement(children, { ...slotProps })
})

Slot.displayName = 'Slot'

export default Slot
