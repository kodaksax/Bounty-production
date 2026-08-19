/**
 * Guards the structural contract of the poster_first welcome screen: all three
 * CTAs present, in spec order, with brand green on the Poster button and the
 * outline on the Hunter button.
 *
 * This exists because the primary "Name your price" button was once silently
 * deleted from the JSX. Everything still compiled, typechecked and linted —
 * the screen just quietly lost the CTA the entire redesign was built to push.
 * The green-on-poster inversion is the whole point of the variant, so it gets
 * asserted rather than eyeballed.
 */

import { fireEvent, render } from '@testing-library/react-native'
import React from 'react'

jest.mock('react-native', () => {
  const ReactMock = require('react')
  const passthrough = (name: string) =>
    ({ children, ...props }: any) => ReactMock.createElement(name, props, children)
  return {
    StyleSheet: { create: (s: any) => s, flatten: (s: any) => s },
    View: passthrough('View'),
    Text: passthrough('Text'),
    TouchableOpacity: passthrough('TouchableOpacity'),
    Platform: { OS: 'ios' },
    PixelRatio: { getFontScale: () => 1 },
    Animated: { View: passthrough('View'), Value: class {}, timing: () => ({ start: () => {} }) },
    AppState: { currentState: 'active', addEventListener: () => ({ remove: () => {} }) },
    AccessibilityInfo: {
      isReduceMotionEnabled: () => Promise.resolve(true),
      isScreenReaderEnabled: () => Promise.resolve(false),
      announceForAccessibility: jest.fn(),
      addEventListener: () => ({ remove: () => {} }),
    },
  }
})

jest.mock('../../../components/ui/branding-logo', () => ({ BrandingLogo: () => null }))
// The card has its own suite (ProofCard.test.tsx); stubbing it here keeps this
// one about screen structure and avoids its async fetch tripping act()
// warnings on every case below.
jest.mock('../../../components/onboarding/ProofCard', () => ({
  ProofCard: () => null,
}))

import { PosterFirstWelcome } from '../../../components/onboarding/PosterFirstWelcome'
import { firstScreenStrings } from '../../../lib/strings/firstScreen'

const BRAND_GREEN = '#059669'

const theme = {
  primary: BRAND_GREEN,
  text: '#ffffff',
  background: '#0B0F14',
  border: '#374151',
  overlay: 'rgba(255,255,255,0.1)',
  isDark: true,
  radius: { xl: 16, full: 9999 },
} as any

function renderScreen(overrides: Partial<React.ComponentProps<typeof PosterFirstWelcome>> = {}) {
  return render(
    <PosterFirstWelcome
      theme={theme}
      insets={{ top: 50, bottom: 34 }}
      stopped={false}
      onProofActiveChange={() => {}}
      onProofImpression={() => {}}
      onPosterPress={() => {}}
      onHunterPress={() => {}}
      onLoginPress={() => {}}
      {...overrides}
    />
  )
}

/** Flattens the possibly-array `style` prop into one object. */
function styleOf(node: any): Record<string, any> {
  const style = node.props.style
  return Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : { ...style }
}

describe('PosterFirstWelcome CTAs', () => {
  it('renders all three CTAs with the exact spec copy', () => {
    const { getByText } = renderScreen()

    getByText(firstScreenStrings.primaryCta)
    getByText(firstScreenStrings.secondaryCta)
    getByText('Log In')

    expect(firstScreenStrings.primaryCta).toBe('Name your price')
    expect(firstScreenStrings.secondaryCta).toBe("I'd rather earn")
  })

  it('orders them poster, then hunter, then log in', () => {
    const { toJSON } = renderScreen()

    // Root children are [top, actions]; the CTA stack is the second.
    const actions = (toJSON() as any).children[1]
    const labels = actions.children.map((child: any) => child.props.accessibilityLabel)

    expect(labels).toEqual([
      'Name your price — post a task and hire someone nearby',
      "I'd rather earn — browse and accept paid tasks",
      'Log in to an existing account',
    ])
  })

  it('puts brand green on the Poster CTA, not the Hunter CTA', () => {
    const { getByLabelText } = renderScreen()

    const poster = styleOf(getByLabelText(/^Name your price/))
    const hunter = styleOf(getByLabelText(/^I'd rather earn/))

    // The inversion the whole variant exists for.
    expect(poster.backgroundColor).toBe(BRAND_GREEN)
    expect(hunter.backgroundColor).toBe('transparent')
    expect(hunter.borderWidth).toBe(1.5)
    expect(hunter.backgroundColor).not.toBe(BRAND_GREEN)
  })

  it('gives both primary CTAs a 60pt tap target', () => {
    const { getByLabelText } = renderScreen()

    expect(styleOf(getByLabelText(/^Name your price/)).height).toBe(60)
    expect(styleOf(getByLabelText(/^I'd rather earn/)).height).toBe(60)
  })

  it('routes each CTA to its own handler', () => {
    const onPosterPress = jest.fn()
    const onHunterPress = jest.fn()
    const onLoginPress = jest.fn()
    const { getByText } = renderScreen({ onPosterPress, onHunterPress, onLoginPress })

    fireEvent.press(getByText(firstScreenStrings.primaryCta))
    expect(onPosterPress).toHaveBeenCalledTimes(1)
    expect(onHunterPress).not.toHaveBeenCalled()

    fireEvent.press(getByText(firstScreenStrings.secondaryCta))
    expect(onHunterPress).toHaveBeenCalledTimes(1)

    fireEvent.press(getByText('Log In'))
    expect(onLoginPress).toHaveBeenCalledTimes(1)
  })

  it('renders the headline exactly, as a header', () => {
    const { getByText } = renderScreen()
    const headline = getByText("You've walked past it four hundred times.")

    expect(headline.props.accessibilityRole).toBe('header')
    // No numberOfLines clamp: the headline must be free to wrap to 3 lines at
    // 1.3x font scale (spec §9) rather than clipping at 2.
    expect(headline.props.numberOfLines).toBeUndefined()
  })
})
