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
    ActivityIndicator: passthrough('ActivityIndicator'),
  }
})

jest.mock('@expo/vector-icons', () => ({ MaterialIcons: () => null }))
jest.mock('../../../lib/haptic-feedback', () => ({
  hapticFeedback: { light: jest.fn(), success: jest.fn(), error: jest.fn(), medium: jest.fn() },
}))
jest.mock('../../../components/error-banner', () => ({
  ErrorBanner: ({ error }: any) => require('react').createElement('Text', { testID: 'error-banner' }, error.title),
}))
jest.mock('../../../components/ui/skeleton', () => ({
  Skeleton: () => require('react').createElement('View', { testID: 'skeleton' }),
}))
jest.mock('../../../components/onboarding/OnboardingProgressDots', () => ({
  OnboardingProgressDots: () => null,
}))

import { HunterSampleBountyScreen } from '../../../components/onboarding/HunterSampleBountyScreen'
import { makeOnboardingDetailsStyles } from '../../../lib/onboarding/onboarding-details-styles'
import type { Bounty } from '../../../lib/services/database.types'

const theme = { primary: '#00912C', textDisabled: '#999999', error: '#ff0000' } as any
const styles = makeOnboardingDetailsStyles(theme)

const sampleBounty: Bounty = {
  id: 'b1',
  title: 'Mow the lawn',
  description: '',
  amount: 25,
  is_for_honor: false,
  location: 'San Francisco, CA',
  timeline: 'Flexible',
  skills_required: '',
  poster_id: 'poster-1',
  created_at: new Date().toISOString(),
  status: 'open',
} as Bounty

function renderScreen(overrides: Partial<React.ComponentProps<typeof HunterSampleBountyScreen>> = {}) {
  const onNext = jest.fn()
  const onSkip = jest.fn()
  const onNotifyMe = jest.fn().mockResolvedValue(true)
  const onSwitchToPoster = jest.fn()
  const onBrowseOnline = jest.fn()
  const onUseLocation = jest.fn()
  const onRetryDiscovery = jest.fn()
  const onBack = jest.fn()

  const utils = render(
    <HunterSampleBountyScreen
      theme={theme}
      styles={styles}
      insets={{ top: 0, bottom: 0 }}
      recentBounties={[]}
      onNext={onNext}
      applying={false}
      onSkip={onSkip}
      onNotifyMe={onNotifyMe}
      onSwitchToPoster={onSwitchToPoster}
      bountySource={null}
      onBrowseOnline={onBrowseOnline}
      onUseLocation={onUseLocation}
      isResolvingLocation={false}
      discoveryError={null}
      onRetryDiscovery={onRetryDiscovery}
      onBack={onBack}
      {...overrides}
    />,
  )

  return { ...utils, onNext, onSkip, onNotifyMe, onSwitchToPoster, onBrowseOnline, onUseLocation, onRetryDiscovery, onBack }
}

describe('HunterSampleBountyScreen empty states', () => {
  test('shows "Browse Online Bounties" as the primary CTA when nearby search came back empty', () => {
    const { getByLabelText, onBrowseOnline } = renderScreen({ recentBounties: [], bountySource: 'nearby' })
    const cta = getByLabelText('Browse online bounties')
    expect(cta).toBeTruthy()
    fireEvent.press(cta)
    expect(onBrowseOnline).toHaveBeenCalledTimes(1)
  })

  test('falls back to "Notify me" when even the online fallback is empty', () => {
    const { queryByLabelText, getByLabelText } = renderScreen({ recentBounties: [], bountySource: 'online' })
    expect(queryByLabelText('Browse online bounties')).toBeNull()
    expect(getByLabelText('Notify me when a bounty appears nearby')).toBeTruthy()
  })

  test('offers a subtle "enable location" link once viewing the online fallback', () => {
    const { getByLabelText, onUseLocation } = renderScreen({ recentBounties: [], bountySource: 'online' })
    fireEvent.press(getByLabelText('Enable location to see bounties near you'))
    expect(onUseLocation).toHaveBeenCalledTimes(1)
  })

  test('does not offer the "enable location" link while still searching nearby', () => {
    const { queryByLabelText } = renderScreen({ recentBounties: [], bountySource: 'nearby' })
    expect(queryByLabelText('Enable location to see bounties near you')).toBeNull()
  })

  test('renders a retryable error banner when discovery fails', () => {
    const { getByTestId } = renderScreen({
      recentBounties: [],
      bountySource: 'nearby',
      discoveryError: { type: 'network', title: 'Connection Error', message: 'oops', retryable: true, action: 'Retry' },
    })
    expect(getByTestId('error-banner')).toBeTruthy()
  })
})

describe('HunterSampleBountyScreen populated state', () => {
  test('offers the "enable location" link on a populated online-fallback result', () => {
    const { getByLabelText, onUseLocation } = renderScreen({ recentBounties: [sampleBounty], bountySource: 'online' })
    fireEvent.press(getByLabelText('Enable location to see bounties near you'))
    expect(onUseLocation).toHaveBeenCalledTimes(1)
  })

  test('does not offer the "enable location" link for a populated nearby result', () => {
    const { queryByLabelText } = renderScreen({ recentBounties: [sampleBounty], bountySource: 'nearby' })
    expect(queryByLabelText('Enable location to see bounties near you')).toBeNull()
  })
})
