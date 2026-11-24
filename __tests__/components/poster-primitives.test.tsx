/**
 * Focus-first primitives (components/poster): PosterButton kinds and states,
 * the workspace header's step announcement and side label, the four
 * questions, the money line's look per kind, and the plain-button controls
 * (time picks, star rating, other options) that replace swipes and drags.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { darkTheme } from '../../lib/themes/darkTheme';
import { lightTheme } from '../../lib/themes/lightTheme';
import { derivePosterPalette } from '../../lib/themes/poster-palette';

let mockTheme = lightTheme;
jest.mock('../../lib/themes/AppThemeContext', () => ({ useAppThemeContext: () => ({ theme: mockTheme }) }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('../../components/ui/app-modal', () => ({
  AppModal: ({ visible, children }: { visible: boolean; children: React.ReactNode }) => (visible ? children : null),
}));

import {
  describeStars,
  describeStep,
  FourQuestions,
  getMoneyLook,
  getPosterButtonLook,
  OtherOptions,
  PosterButton,
  SidePill,
  StarRating,
  WorkspaceHeader,
} from '../../components/poster';

beforeEach(() => {
  mockTheme = lightTheme;
});

/** jest.setup.js mocks react-native's StyleSheet, so flatten by hand. */
function flat(style: unknown): Record<string, unknown> {
  const list = ([] as unknown[]).concat(style as never).flat(Infinity as 1);
  return list.reduce<Record<string, unknown>>((acc, s) => (s && typeof s === 'object' ? { ...acc, ...(s as object) } : acc), {});
}

describe('poster palette', () => {
  it('adds no colours of its own: every role is an existing app colour', () => {
    for (const theme of [lightTheme, darkTheme]) {
      const { poster, ...rest } = theme;
      const appColours = new Set(Object.values(rest).filter((v): v is string => typeof v === 'string'));
      for (const value of Object.values(poster)) expect(appColours.has(value)).toBe(true);
      expect(poster).toEqual(derivePosterPalette(rest));
    }
  });

  it('keeps light and dark roles on their own theme', () => {
    expect(lightTheme.poster.bg).toBe(lightTheme.background);
    expect(darkTheme.poster.bg).toBe(darkTheme.background);
    expect(darkTheme.poster.ink).toBe(darkTheme.text);
  });
});

describe('PosterButton', () => {
  const p = lightTheme.poster;

  it.each([
    ['primary', 56],
    ['quiet', 56],
    ['danger', 56],
    ['secondary', 52],
    ['neutral', 52],
    ['text', 48],
    ['muted', 48],
  ] as const)('%s is %ipt tall, above the 44pt minimum', (kind, height) => {
    const look = getPosterButtonLook(kind, p);
    expect(look.minHeight).toBe(height);
    expect(look.minHeight).toBeGreaterThanOrEqual(44);
  });

  it('draws muted as underlined text and disabled/loading dimmed', () => {
    expect(getPosterButtonLook('muted', p).underline).toBe(true);
    expect(getPosterButtonLook('disabled', p).opacity).toBe(0.45);
    expect(getPosterButtonLook('loading', p).opacity).toBe(0.8);
    expect(getPosterButtonLook('danger', p).backgroundColor).toBe(p.e);
  });

  it('fires onPress when enabled', () => {
    const onPress = jest.fn();
    render(<PosterButton label="Send to Ada" onPress={onPress} testID="b" />);
    fireEvent.press(screen.getByLabelText('Send to Ada'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('reports disabled and ignores taps', () => {
    const onPress = jest.fn();
    render(<PosterButton label="Choose Ada" onPress={onPress} disabled testID="b" />);
    const button = screen.getByTestId('b');
    expect(button.props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));
    // The host touchable gets no handler at all, so no tap can reach onPress.
    expect(button.props.onPress).toBeUndefined();
  });

  it('while loading: busy, spinner, spoken loading label, no taps', () => {
    const onPress = jest.fn();
    render(<PosterButton label="Yes, pay Ada $60" loadingLabel="Sending payment" loading onPress={onPress} testID="b" />);
    const button = screen.getByTestId('b');
    expect(button.props.accessibilityState).toEqual(expect.objectContaining({ busy: true, disabled: true }));
    expect(button.props.accessibilityLabel).toBe('Sending payment');
    expect(screen.getByTestId('b-spinner')).toBeTruthy();
    expect(button.props.onPress).toBeUndefined();
  });

  it('the drawn-disabled kind is disabled too', () => {
    render(<PosterButton label="Pay" kind="disabled" testID="b" />);
    expect(screen.getByTestId('b').props.accessibilityState.disabled).toBe(true);
  });
});

describe('WorkspaceHeader', () => {
  it('says the step in words to assistive technology', () => {
    expect(describeStep(2, 'Step 2 of 5 · Choosing someone to help')).toBe('Step 2 of 5 · Choosing someone to help');
    expect(describeStep(4, 'Paused · Bounty is reviewing')).toBe('Step 4 of 5 · Paused · Bounty is reviewing');
    expect(describeStep(9, 'Finished')).toBe('Step 5 of 5 · Finished');
  });

  it('renders back, Help, title, meta, the side label and an accessible step', () => {
    const onBack = jest.fn();
    const onHelp = jest.fn();
    render(
      <WorkspaceHeader
        onBack={onBack}
        onHelp={onHelp}
        icon="chair"
        title="Clear old furniture out of my garage"
        meta="$60 · Posted Monday"
        side="posted"
        step={2}
        stage="Step 2 of 5 · Choosing someone to help"
      />
    );
    fireEvent.press(screen.getByLabelText('Back to My Jobs'));
    fireEvent.press(screen.getByLabelText('Help with this job'));
    expect(onBack).toHaveBeenCalled();
    expect(onHelp).toHaveBeenCalled();
    expect(screen.getByText('$60 · Posted Monday')).toBeTruthy();
    expect(screen.getByText('You posted this')).toBeTruthy();
    const step = screen.getByTestId('workspace-step');
    expect(step.props.accessibilityLabel).toBe('Step 2 of 5 · Choosing someone to help');
    expect(step.props.accessibilityValue).toEqual({ min: 1, max: 5, now: 2 });
  });

  it('shows no side label unless asked', () => {
    render(<WorkspaceHeader onBack={jest.fn()} icon="chair" title="t" step={1} stage="Step 1 of 5 · Finding someone" />);
    expect(screen.queryByTestId('side-label-posted')).toBeNull();
  });

  it('side labels are words first, in the handoff colour roles', () => {
    render(<SidePill side="doing" />);
    expect(screen.getByText("You're doing this")).toBeTruthy();
    const pill = screen.getByTestId('side-label-doing');
    expect(flat(pill.props.style).backgroundColor).toBe(lightTheme.poster.itint);
  });
});

describe('FourQuestions / MoneyLine', () => {
  it('answers the four questions in order', () => {
    render(
      <FourQuestions
        now="3 people want to help."
        means="Look at each person, then choose one."
        money={{ kind: 'none', text: "You haven't paid anything yet." }}
        after="The person you choose starts the work."
      />
    );
    expect(screen.getByText("WHAT'S HAPPENING")).toBeTruthy();
    expect(screen.getByText('WHAT IT MEANS')).toBeTruthy();
    expect(screen.getByTestId('qa-now').props.children).toBe('3 people want to help.');
    expect(screen.getByTestId('money-line').props.accessibilityLabel).toBe("Your money. You haven't paid anything yet.");
    expect(screen.getByTestId('qa-after')).toBeTruthy();
  });

  it('omits money and after when a stage has none', () => {
    render(<FourQuestions now="n" means="m" />);
    expect(screen.queryByTestId('money-line')).toBeNull();
    expect(screen.queryByTestId('qa-after')).toBeNull();
  });

  it('maps each money kind to its icon and tint', () => {
    const p = lightTheme.poster;
    expect(getMoneyLook('held', p)).toEqual(expect.objectContaining({ icon: 'lock', bg: p.gtint }));
    expect(getMoneyLook('released', p).icon).toBe('check-circle');
    expect(getMoneyLook('warn', p)).toEqual(expect.objectContaining({ icon: 'priority-high', bg: p.wtint }));
    expect(getMoneyLook('ph', p).dashed).toBe(true);
    expect(getMoneyLook('none', p).icon).toBe('account-balance-wallet');
  });
});

describe('controls', () => {
  it('star rating says the choice in words', () => {
    const onChange = jest.fn();
    render(<StarRating value={4} onChange={onChange} />);
    expect(screen.getByText('4 out of 5 · Good')).toBeTruthy();
    fireEvent.press(screen.getByTestId('star-5'));
    expect(onChange).toHaveBeenCalledWith(5);
    expect(describeStars(0)).toBe('Tap a number');
  });

  it('other options start collapsed and open on tap', () => {
    const onEdit = jest.fn();
    render(<OtherOptions items={[{ key: 'edit', label: 'Edit job details', icon: 'edit', onPress: onEdit }]} />);
    expect(screen.queryByTestId('option-edit')).toBeNull();
    fireEvent.press(screen.getByTestId('other-options-toggle'));
    fireEvent.press(screen.getByTestId('option-edit'));
    expect(onEdit).toHaveBeenCalled();
  });

  it('renders the same in dark mode', () => {
    mockTheme = darkTheme;
    render(<SidePill side="posted" />);
    const pill = screen.getByTestId('side-label-posted');
    expect(flat(pill.props.style).backgroundColor).toBe(darkTheme.poster.gtint);
  });
});
