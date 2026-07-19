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
    TextInput: passthrough('TextInput'),
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

import { HunterLocationPrompt } from '../../../components/onboarding/HunterLocationPrompt'
import { makeOnboardingDetailsStyles } from '../../../lib/onboarding/onboarding-details-styles'

const theme = {
  primary: '#00912C',
  textDisabled: '#999999',
  error: '#ff0000',
} as any
const styles = makeOnboardingDetailsStyles(theme)

function renderPrompt(overrides: Partial<React.ComponentProps<typeof HunterLocationPrompt>> = {}) {
  const onUseLocation = jest.fn()
  const onSubmitZip = jest.fn()
  const onSkip = jest.fn()
  const onSwitchToPoster = jest.fn()
  const onRetryDiscovery = jest.fn()
  const onBack = jest.fn()

  const utils = render(
    <HunterLocationPrompt
      theme={theme}
      styles={styles}
      insets={{ top: 0, bottom: 0 }}
      displayName="goonsquad"
      recentBounties={[]}
      onUseLocation={onUseLocation}
      onSubmitZip={onSubmitZip}
      onSkip={onSkip}
      onSwitchToPoster={onSwitchToPoster}
      onBack={onBack}
      isResolvingLocation={false}
      zipSubmitError={null}
      discoveryError={null}
      onRetryDiscovery={onRetryDiscovery}
      {...overrides}
    />,
  )

  return { ...utils, onUseLocation, onSubmitZip, onSkip, onSwitchToPoster, onBack, onRetryDiscovery }
}

describe('HunterLocationPrompt', () => {
  test('tapping "Use my location" calls onUseLocation', () => {
    const { getByLabelText, onUseLocation } = renderPrompt()
    fireEvent.press(getByLabelText('Use my location to find bounties near me'))
    expect(onUseLocation).toHaveBeenCalledTimes(1)
  })

  test('reveals a ZIP input after tapping "Browse by ZIP instead"', () => {
    const { getByLabelText, queryByLabelText } = renderPrompt()
    expect(queryByLabelText('ZIP code')).toBeNull()
    fireEvent.press(getByLabelText('Browse by ZIP code instead'))
    expect(getByLabelText('ZIP code')).toBeTruthy()
  })

  test('rejects a malformed ZIP without calling onSubmitZip', () => {
    const { getByLabelText, getByText, onSubmitZip } = renderPrompt()
    fireEvent.press(getByLabelText('Browse by ZIP code instead'))
    fireEvent.changeText(getByLabelText('ZIP code'), '123')
    fireEvent.press(getByLabelText('Search bounties near this ZIP code'))
    expect(onSubmitZip).not.toHaveBeenCalled()
    expect(getByText('Enter a valid 5-digit ZIP code.')).toBeTruthy()
  })

  test('submits a valid 5-digit ZIP', () => {
    const { getByLabelText, onSubmitZip } = renderPrompt()
    fireEvent.press(getByLabelText('Browse by ZIP code instead'))
    fireEvent.changeText(getByLabelText('ZIP code'), '94103')
    fireEvent.press(getByLabelText('Search bounties near this ZIP code'))
    expect(onSubmitZip).toHaveBeenCalledWith('94103')
  })

  test('strips non-numeric characters and caps ZIP input at 5 digits', () => {
    const { getByLabelText } = renderPrompt()
    fireEvent.press(getByLabelText('Browse by ZIP code instead'))
    const input = getByLabelText('ZIP code')
    fireEvent.changeText(input, '9a4b1c0d3e9')
    expect(input.props.value).toBe('94103')
  })

  test('surfaces a geocode-level ZIP error passed from the parent', () => {
    const { getByLabelText, getByText } = renderPrompt({ zipSubmitError: "We couldn't find that ZIP code." })
    fireEvent.press(getByLabelText('Browse by ZIP code instead'))
    expect(getByText("We couldn't find that ZIP code.")).toBeTruthy()
  })

  test('disables both CTAs while a resolution is in flight', () => {
    const { getByLabelText } = renderPrompt({ isResolvingLocation: true })
    expect(getByLabelText('Use my location to find bounties near me').props.accessibilityState.disabled).toBe(true)
    expect(getByLabelText('Browse by ZIP code instead').props.accessibilityState).toBeUndefined()
  })

  test('renders a retryable error banner when discovery fails', () => {
    const { getByTestId } = renderPrompt({
      discoveryError: { type: 'network', title: 'Connection Error', message: 'oops', retryable: true, action: 'Retry' },
    })
    expect(getByTestId('error-banner')).toBeTruthy()
  })
})
