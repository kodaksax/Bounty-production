import type { BountyFormat } from './bounty-format-context'

export interface BountyFormatOption {
  value: BountyFormat
  icon: string
  label: string
  description: string
}

// Single source of truth for the selectable bounty-display formats, shared by
// the onboarding style step (app/onboarding/style.tsx) and the Settings
// "Bounty Display" picker (components/settings-screen.tsx). Adding a new
// format only requires adding an entry here — both surfaces pick it up
// automatically.
export const BOUNTY_FORMAT_OPTIONS: BountyFormatOption[] = [
  {
    value: 'card',
    icon: '🃏',
    label: 'Card',
    description: 'Big, swipeable cards — one bounty at a time.',
  },
  {
    value: 'compact',
    icon: '☰',
    label: 'Compact',
    description: 'A dense list — scan more bounties at once.',
  },
  {
    value: 'grid',
    icon: '⊞',
    label: 'Grid',
    description: 'A two-column grid — browse visually.',
  },
]

// Single canonical index<->value mapping, used by both the onboarding
// swipeable pager (tap-to-select and swipe-to-select) so the two input
// methods can never disagree about which option a given index/offset
// represents.
export function formatForIndex(index: number): BountyFormat | undefined {
  return BOUNTY_FORMAT_OPTIONS[index]?.value
}

export function indexForFormat(format: BountyFormat): number {
  const index = BOUNTY_FORMAT_OPTIONS.findIndex((o) => o.value === format)
  return index === -1 ? 0 : index
}

// offsetX is a paged ScrollView's settled contentOffset.x; pageWidth is the
// width of one page. Rounds to the nearest page rather than requiring an
// exact match so sub-pixel layout/scroll measurements still resolve to the
// intended page.
export function formatForScrollOffset(offsetX: number, pageWidth: number): BountyFormat | undefined {
  if (!(pageWidth > 0)) return undefined
  const index = Math.round(offsetX / pageWidth)
  return formatForIndex(index)
}
