/**
 * Component-level tests for CaptchaChallenge.
 *
 * Tests cover: initial render, correct answer verification, wrong answer
 * feedback, refresh behaviour, and callback invocations.
 *
 * The challenge is randomly generated, so tests derive the expected answer
 * from the rendered accessibilityLabel rather than assuming a fixed question.
 */

import React from 'react'
import { render, fireEvent } from '@testing-library/react-native'
import { CaptchaChallenge } from '../../components/ui/captcha-challenge'

/** Parse and solve the arithmetic question embedded in the input's label. */
function solveQuestion(label: string): string {
  // Label is: "Enter the answer to A + B" or "Enter the answer to A - B"
  const match = label.match(/(\d+)\s*([+-])\s*(\d+)$/)
  if (!match) throw new Error(`Cannot parse question from label: "${label}"`)
  const [, a, op, b] = match
  const result = op === '+' ? parseInt(a) + parseInt(b) : parseInt(a) - parseInt(b)
  return String(result)
}

/** Return a numeric string that is definitely NOT the correct answer. */
function wrongAnswer(label: string): string {
  const correct = parseInt(solveQuestion(label), 10)
  // Max possible answer is 9+9=18; offset by 1, staying within valid range.
  const MAX_ANSWER = 18
  return String(correct + 1 <= MAX_ANSWER ? correct + 1 : correct - 1)
}

describe('CaptchaChallenge component', () => {
  it('renders the Security Check header', () => {
    const { getByText } = render(
      <CaptchaChallenge onVerified={jest.fn()} />
    )
    expect(getByText(/Security Check/i)).toBeTruthy()
  })

  it('renders the answer input with an accessibilityLabel describing the question', () => {
    const { getByLabelText } = render(
      <CaptchaChallenge onVerified={jest.fn()} />
    )
    expect(getByLabelText(/Enter the answer to/i)).toBeTruthy()
  })

  it('calls onVerified when the correct answer is typed', () => {
    const onVerified = jest.fn()
    const { getByLabelText } = render(
      <CaptchaChallenge onVerified={onVerified} />
    )
    const input = getByLabelText(/Enter the answer to/i)
    fireEvent.changeText(input, solveQuestion(input.props.accessibilityLabel))
    expect(onVerified).toHaveBeenCalledTimes(1)
  })

  it('does NOT call onVerified for an incorrect answer', () => {
    const onVerified = jest.fn()
    const { getByLabelText } = render(
      <CaptchaChallenge onVerified={onVerified} />
    )
    const input = getByLabelText(/Enter the answer to/i)
    fireEvent.changeText(input, wrongAnswer(input.props.accessibilityLabel))
    expect(onVerified).not.toHaveBeenCalled()
  })

  it('shows the "Incorrect answer" message after a full-length wrong answer', () => {
    const { getByLabelText, getByText } = render(
      <CaptchaChallenge onVerified={jest.fn()} />
    )
    const input = getByLabelText(/Enter the answer to/i)
    fireEvent.changeText(input, wrongAnswer(input.props.accessibilityLabel))
    expect(getByText(/Incorrect answer/i)).toBeTruthy()
  })

  it('clears the wrong-answer message when input changes', () => {
    const { getByLabelText, queryByText } = render(
      <CaptchaChallenge onVerified={jest.fn()} />
    )
    const input = getByLabelText(/Enter the answer to/i)
    fireEvent.changeText(input, wrongAnswer(input.props.accessibilityLabel))
    fireEvent.changeText(input, '') // clear input
    expect(queryByText(/Incorrect answer/i)).toBeNull()
  })

  it('shows the "Verification passed" message after the correct answer', () => {
    const { getByLabelText, getByText } = render(
      <CaptchaChallenge onVerified={jest.fn()} />
    )
    const input = getByLabelText(/Enter the answer to/i)
    fireEvent.changeText(input, solveQuestion(input.props.accessibilityLabel))
    expect(getByText(/Verification passed/i)).toBeTruthy()
  })

  it('calls onReset when the refresh button is pressed', () => {
    const onReset = jest.fn()
    const { getByLabelText } = render(
      <CaptchaChallenge onVerified={jest.fn()} onReset={onReset} />
    )
    fireEvent.press(getByLabelText(/Get a new challenge/i))
    expect(onReset).toHaveBeenCalledTimes(1)
  })

  it('resets to unverified state after refresh', () => {
    const onVerified = jest.fn()
    const onReset = jest.fn()
    const { getByLabelText, queryByText } = render(
      <CaptchaChallenge onVerified={onVerified} onReset={onReset} />
    )
    // Pressing refresh while unverified clears any partial input and fires onReset
    fireEvent.press(getByLabelText(/Get a new challenge/i))
    expect(onReset).toHaveBeenCalledTimes(1)
    // Component stays in unverified state — no "Verification passed" shown
    expect(queryByText(/Verification passed/i)).toBeNull()
    // onVerified must NOT have been called
    expect(onVerified).not.toHaveBeenCalled()
  })
})

