/**
 * Coverage for the founder-note signature typewriter
 * (app/onboarding/founder-note.tsx), where the founder's name types itself out
 * in the same face and at the same pace as the quote above it.
 *
 * What's worth pinning down is the ordering and the escape hatch: the
 * signature must not start until the quote has finished (the two share one
 * caret, and an overlapping start would show two), and under Reduce Motion the
 * whole note must render complete with Continue tappable immediately rather
 * than waiting on typing the user asked not to see.
 */
import React from 'react';
import { act, render } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));

// The glow is an SVG radial gradient, and react-native-svg doesn't load under
// Jest; it's pure decoration, so it renders nothing here.
jest.mock('../../../components/onboarding/CarouselGlow', () => ({
  CarouselGlow: () => null,
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../../../lib/context/onboarding-context', () => ({
  useOnboarding: () => ({ data: { intent: 'poster' }, updateData: jest.fn() }),
}));

jest.mock('../../../lib/services/analytics-service', () => ({
  analyticsService: { trackEvent: jest.fn() },
}));

jest.mock('../../../lib/haptic-feedback', () => ({
  hapticFeedback: { light: jest.fn(), success: jest.fn(), error: jest.fn(), medium: jest.fn() },
}));

import FounderNoteScreen from '../../../app/onboarding/founder-note';
import { founderNoteStrings } from '../../../lib/strings/founderNote';

const SIGNATURE_LINE = `${founderNoteStrings.signatureDash} ${founderNoteStrings.signature}`;
const QUOTE = founderNoteStrings.quoteLines.join('\n');

// Long enough to outlast either line's typing (~80ms/char plus a beat per line
// break), whatever the copy grows to.
const PAST_TYPING_MS = 30_000;

function typedSignature(api: ReturnType<typeof render>) {
  // Children, not the rendered string: the caret is a sibling node while the
  // line is mid-type, and it isn't part of the signature.
  const [typed] = api.getByTestId('founder-signature').props.children;
  return typed;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  (AccessibilityInfo.isReduceMotionEnabled as jest.Mock).mockResolvedValue(false);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('founder note signature typewriter', () => {
  it('holds the signature back until the quote has finished typing', async () => {
    const api = render(<FounderNoteScreen />);
    await act(async () => {
      await Promise.resolve();
    });

    // One second in: the quote is still going, so the signature is untouched.
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(typedSignature(api)).toBe('');
  });

  it('types the whole signature out once the quote has landed', async () => {
    const api = render(<FounderNoteScreen />);
    await act(async () => {
      await Promise.resolve();
    });
    // Two passes on purpose: the signature's timers are only scheduled by the
    // effect that reacts to the quote finishing, which commits at the end of
    // the first act() — a single long advance would leave them unrun.
    await act(async () => {
      jest.advanceTimersByTime(PAST_TYPING_MS);
    });
    await act(async () => {
      jest.advanceTimersByTime(PAST_TYPING_MS);
    });

    expect(typedSignature(api)).toBe(SIGNATURE_LINE);
    // Two matches, not one: the typed quote plus the ghost copy behind it that
    // reserves the block's size.
    expect(api.getAllByText(QUOTE)).toHaveLength(2);
  });

  it('renders complete with Continue tappable under Reduce Motion', async () => {
    (AccessibilityInfo.isReduceMotionEnabled as jest.Mock).mockResolvedValue(true);

    const api = render(<FounderNoteScreen />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(typedSignature(api)).toBe(SIGNATURE_LINE);
    expect(api.getByLabelText(founderNoteStrings.primaryCta).props.accessibilityState).toMatchObject(
      { disabled: false }
    );
  });
});
