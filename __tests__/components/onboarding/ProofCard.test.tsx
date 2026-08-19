/**
 * Covers the first-screen proof card's non-negotiable data-integrity rules:
 * a completed bounty is never fabricated, the fallback chain runs
 * completed -> open -> static card, and an unavailable distance is omitted
 * rather than faked. Rotation/reduce-motion behaviour is covered here too,
 * since a stalled or over-eager rotation is what would surface stale proof.
 */

import { act, render } from '@testing-library/react-native'
import React from 'react'

jest.mock('react-native', () => {
  const ReactMock = require('react')
  const passthrough = (name: string) =>
    ({ children, ...props }: any) => ReactMock.createElement(name, props, children)

  const listeners: Record<string, ((value: any) => void)[]> = {}
  const addListener = (event: string, handler: (value: any) => void) => {
    listeners[event] = listeners[event] ?? []
    listeners[event].push(handler)
    return {
      remove: () => {
        listeners[event] = (listeners[event] ?? []).filter(h => h !== handler)
      },
    }
  }

  return {
    __listeners: listeners,
    StyleSheet: { create: (s: any) => s, flatten: (s: any) => s },
    View: passthrough('View'),
    Text: passthrough('Text'),
    Platform: { OS: 'ios' },
    PixelRatio: { getFontScale: jest.fn(() => 1) },
    Animated: {
      View: passthrough('View'),
      Value: class {
        constructor(public value: number) {}
        setValue(next: number) {
          this.value = next
        }
      },
      // Run the crossfade synchronously so the index advance in the
      // fade-out callback lands within the same act() as the interval tick.
      timing: (node: any, config: any) => ({
        start: (cb?: () => void) => {
          node.setValue(config.toValue)
          cb?.()
        },
      }),
    },
    AppState: { currentState: 'active', addEventListener: addListener },
    AccessibilityInfo: {
      isReduceMotionEnabled: jest.fn(() => Promise.resolve(false)),
      isScreenReaderEnabled: jest.fn(() => Promise.resolve(false)),
      announceForAccessibility: jest.fn(),
      addEventListener: addListener,
    },
  }
})

jest.mock('../../../lib/data/socialProofStub', () => ({
  fetchSocialProof: jest.fn(),
}))
jest.mock('../../../lib/services/location-service', () => ({
  locationService: {
    getPermissionStatus: jest.fn(() => Promise.resolve({ granted: false, status: 'undetermined' })),
    getCurrentLocation: jest.fn(),
  },
}))

import { ProofCard } from '../../../components/onboarding/ProofCard'
import { fetchSocialProof, type SocialProofItem } from '../../../lib/data/socialProofStub'
import { locationService } from '../../../lib/services/location-service'
import { AccessibilityInfo, PixelRatio } from 'react-native'

const theme = {
  primary: '#059669',
  text: '#ffffff',
  border: '#374151',
  overlay: 'rgba(255,255,255,0.1)',
  radius: { xl: 16, full: 9999 },
} as any

const HOUR = 60 * 60 * 1000

function completed(overrides: Partial<SocialProofItem> = {}): SocialProofItem {
  return {
    id: 'bnty_c1',
    state: 'completed',
    hunter_first_name: 'Marcus',
    task_summary: 'carried a couch up three flights',
    amount_cents: 4500,
    neighborhood: 'Petworth',
    distance_miles: 1.2,
    timestamp: new Date(Date.now() - 2 * HOUR).toISOString(),
    ...overrides,
  }
}

function open(overrides: Partial<SocialProofItem> = {}): SocialProofItem {
  return {
    id: 'bnty_o1',
    state: 'open',
    hunter_first_name: '',
    task_summary: 'help assembling a bookshelf',
    amount_cents: 3000,
    neighborhood: 'Shaw',
    distance_miles: 1.5,
    timestamp: new Date(Date.now() - 2 * HOUR).toISOString(),
    ...overrides,
  }
}

const mockFetch = fetchSocialProof as jest.MockedFunction<typeof fetchSocialProof>

function renderCard(props: Partial<React.ComponentProps<typeof ProofCard>> = {}) {
  return render(<ProofCard theme={theme} stopped={false} {...props} />)
}

/** Lets the mount-time fetch and accessibility promises settle. */
async function settle() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.useFakeTimers()
  mockFetch.mockResolvedValue({ items: [] })
  ;(AccessibilityInfo.isReduceMotionEnabled as jest.Mock).mockResolvedValue(false)
  ;(AccessibilityInfo.isScreenReaderEnabled as jest.Mock).mockResolvedValue(false)
  ;(locationService.getPermissionStatus as jest.Mock).mockResolvedValue({
    granted: false,
    status: 'undetermined',
  })
  // clearAllMocks() resets usage data but not mockReturnValue, so the font
  // scale has to be put back explicitly or the 1.3x cases leak forward.
  ;(PixelRatio.getFontScale as jest.Mock).mockReturnValue(1)
})

afterEach(() => {
  jest.useRealTimers()
})

describe('ProofCard data integrity', () => {
  it('renders the static fallback card immediately, before the fetch resolves', async () => {
    let resolveFetch: (value: { items: SocialProofItem[] }) => void = () => {}
    mockFetch.mockReturnValue(new Promise(resolve => (resolveFetch = resolve)))

    const { getByText } = renderCard()

    // Never an empty card or a spinner while the request is in flight.
    getByText('A mounted TV. A hauled mattress.\nA closet door that finally closes.')
    getByText('Most bounties run $35–$75')

    await act(async () => {
      resolveFetch({ items: [] })
    })
  })

  it('shows completed bounties once at least three real ones are available', async () => {
    mockFetch.mockResolvedValue({
      items: [
        completed({ id: 'c1' }),
        completed({ id: 'c2', hunter_first_name: 'Dana' }),
        completed({ id: 'c3', hunter_first_name: 'Elijah' }),
      ],
    })

    const { getByText } = renderCard()
    await settle()

    getByText('Marcus carried a couch up three flights in Petworth.')
  })

  it('falls back to open bounties when fewer than three completed ones exist', async () => {
    mockFetch.mockResolvedValue({
      items: [completed({ id: 'c1' }), completed({ id: 'c2' }), open({ id: 'o1' })],
    })

    const { getByText, queryByText } = renderCard()
    await settle()

    getByText('Someone in Shaw needs help assembling a bookshelf.')
    // The two real completed jobs are real, but two is below the bar — none
    // of them may be presented as proof.
    expect(queryByText('Marcus carried a couch up three flights in Petworth.')).toBeNull()
  })

  it('falls back to the static card when the market is cold', async () => {
    mockFetch.mockResolvedValue({ items: [] })

    const { getByText } = renderCard()
    await settle()

    getByText('A mounted TV. A hauled mattress.\nA closet door that finally closes.')
  })

  it('falls back to the static card when the request fails', async () => {
    mockFetch.mockRejectedValue(new Error('network'))

    const { getByText } = renderCard()
    await settle()

    getByText('A mounted TV. A hauled mattress.\nA closet door that finally closes.')
  })

  it('floors the displayed distance at 0.3 mi so "0.0 mi" is never shown', async () => {
    mockFetch.mockResolvedValue({ items: [open({ distance_miles: 0.04 })] })

    const { getByText } = renderCard()
    await settle()

    getByText('$30 · 0.3 mi · posted 2 hrs ago')
  })

  it('omits the distance segment entirely when location is unavailable', async () => {
    mockFetch.mockResolvedValue({ items: [open({ distance_miles: null })] })

    const { getByText } = renderCard()
    await settle()

    // No fabricated distance, and no orphaned separator either.
    getByText('$30 · posted 2 hrs ago')
  })

  it('does not ask for location permission, only reads the existing grant', async () => {
    renderCard()
    await settle()

    expect(locationService.getPermissionStatus).toHaveBeenCalled()
    expect(locationService.getCurrentLocation).not.toHaveBeenCalled()
    expect(mockFetch).toHaveBeenCalledWith({ lat: undefined, lng: undefined, limit: 8 })
  })

  it('sends coarse coordinates when permission was already granted', async () => {
    ;(locationService.getPermissionStatus as jest.Mock).mockResolvedValue({
      granted: true,
      status: 'granted',
    })
    ;(locationService.getCurrentLocation as jest.Mock).mockResolvedValue({
      latitude: 38.9,
      longitude: -77.0,
    })

    renderCard()
    await settle()

    expect(mockFetch).toHaveBeenCalledWith({ lat: 38.9, lng: -77.0, limit: 8 })
  })
})

describe('ProofCard rotation', () => {
  const threeOpen = {
    items: [
      open({ id: 'o1', neighborhood: 'Shaw' }),
      open({ id: 'o2', neighborhood: 'Petworth' }),
      open({ id: 'o3', neighborhood: 'Brookland' }),
    ],
  }

  it('advances to the next card every 4s', async () => {
    mockFetch.mockResolvedValue(threeOpen)

    const { getByText } = renderCard()
    await settle()
    getByText('Someone in Shaw needs help assembling a bookshelf.')

    await act(async () => {
      jest.advanceTimersByTime(4000)
    })
    getByText('Someone in Petworth needs help assembling a bookshelf.')

    await act(async () => {
      jest.advanceTimersByTime(4000)
    })
    getByText('Someone in Brookland needs help assembling a bookshelf.')
  })

  it('does not rotate at all when Reduce Motion is on', async () => {
    ;(AccessibilityInfo.isReduceMotionEnabled as jest.Mock).mockResolvedValue(true)
    mockFetch.mockResolvedValue(threeOpen)

    const { getByText } = renderCard()
    await settle()

    await act(async () => {
      jest.advanceTimersByTime(20000)
    })

    getByText('Someone in Shaw needs help assembling a bookshelf.')
  })

  it('stays frozen once the user has tapped a CTA', async () => {
    mockFetch.mockResolvedValue(threeOpen)

    const { getByText, rerender } = renderCard()
    await settle()

    rerender(<ProofCard theme={theme} stopped />)
    await act(async () => {
      jest.advanceTimersByTime(20000)
    })

    getByText('Someone in Shaw needs help assembling a bookshelf.')
  })

  it('reports an impression only after a card has been shown for a second', async () => {
    const onImpression = jest.fn()
    mockFetch.mockResolvedValue(threeOpen)

    renderCard({ onImpression })
    await settle()
    onImpression.mockClear()

    await act(async () => {
      jest.advanceTimersByTime(999)
    })
    expect(onImpression).not.toHaveBeenCalled()

    await act(async () => {
      jest.advanceTimersByTime(1)
    })
    expect(onImpression).toHaveBeenCalledWith({ index: 0, proofState: 'open', bountyId: 'o1' })
  })
})

describe('ProofCard layout stability', () => {
  /** The card container is the component's root node. */
  const cardStyle = (tree: any) => tree.toJSON().props.style

  it('measures identically whether the copy runs one line or two', async () => {
    mockFetch.mockResolvedValue({ items: [open({ task_summary: 'a hand' })] })
    const short = renderCard()
    await settle()

    mockFetch.mockResolvedValue({
      items: [open({ task_summary: 'help assembling a very large flat-pack bookshelf' })],
    })
    const tall = renderCard()
    await settle()

    // A height that tracked content would nudge the CTAs on every crossfade.
    expect(cardStyle(short).height).toBe(cardStyle(tall).height)
    expect(typeof cardStyle(short).height).toBe('number')
  })

  it('never renders shorter than the 108pt spec floor', async () => {
    const card = renderCard()
    await settle()

    expect(cardStyle(card).height).toBeGreaterThanOrEqual(108)
  })

  it('scales the reserved height with font scale so 1.3x does not clip', async () => {
    const atDefault = renderCard()
    await settle()
    const defaultHeight = cardStyle(atDefault).height

    ;(PixelRatio.getFontScale as jest.Mock).mockReturnValue(1.3)
    const atLarge = renderCard()
    await settle()

    expect(cardStyle(atLarge).height).toBeGreaterThan(defaultHeight)
  })

  it('clamps scaling past the 1.3x support target', async () => {
    ;(PixelRatio.getFontScale as jest.Mock).mockReturnValue(1.3)
    const atLimit = renderCard()
    await settle()

    ;(PixelRatio.getFontScale as jest.Mock).mockReturnValue(3)
    const beyond = renderCard()
    await settle()

    expect(cardStyle(beyond).height).toBe(cardStyle(atLimit).height)
  })
})
