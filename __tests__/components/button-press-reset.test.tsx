/**
 * Regression coverage for the "greyed out and untappable" Sign In button.
 *
 * handlePressOut, handleBlur and handleFocus all early-return while the button
 * is disabled, so a button that flips to `loading` between press-in and
 * press-out kept its pressed/focused state: the thick focus border stayed on
 * and the control looked stuck. The Button now resets that state when it
 * becomes disabled mid-press. The focus ring itself now comes only from real
 * focus events, never from a touch press.
 */

import { act, fireEvent, render } from '@testing-library/react-native';
import React from 'react';

jest.mock('lib/haptic-feedback', () => ({
  useHapticFeedback: () => ({ triggerHaptic: jest.fn() }),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Button } = require('../../components/ui/button');

// The focused style is the only one that raises the border to 3px (WCAG 2.4.7),
// so its presence in the style tree marks the pressed/focused state.
function isFocusedVisually(node: { props: { style: unknown } }) {
  return JSON.stringify(node.props.style).includes('"borderWidth":3');
}

describe('Button press-state reset', () => {
  it('clears the focused state when it becomes disabled while focused', () => {
    const { getByRole, rerender } = render(<Button loading={false}>Go</Button>);

    act(() => {
      fireEvent(getByRole('button'), 'focus');
    });
    expect(isFocusedVisually(getByRole('button'))).toBe(true);

    // Disabling before blur used to leave the focus border on forever.
    rerender(<Button loading>Go</Button>);
    expect(isFocusedVisually(getByRole('button'))).toBe(false);
  });

  it('does not paint the keyboard focus ring for a touch press', () => {
    const { getByRole } = render(<Button>Go</Button>);

    // A tap only depresses the button; the 3px ring is for keyboard focus.
    // It used to appear on every press and shift the label as it widened.
    act(() => {
      fireEvent(getByRole('button'), 'pressIn');
    });
    expect(isFocusedVisually(getByRole('button'))).toBe(false);
  });
});
