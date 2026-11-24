/**
 * Focus-first M.1–M.3 / H.6: when the thread pins a card's next step above
 * the message box, the card in the timeline shows neither its button nor
 * "Your move" — there is one next step on screen, on the pinned card.
 */
import { render, screen } from '@testing-library/react-native';
import React from 'react';
import { InteractiveMessageCard } from '../../components/bounty-inbox/interactive-message-card';
import { lightTheme } from '../../lib/themes/lightTheme';
import { buildBountyThreadEvents, selectPinnedThreadCard } from '../../lib/utils/bounty-thread-events';

jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: ({ children }: { children?: React.ReactNode }) => children ?? null }));
jest.mock('../../lib/themes/AppThemeContext', () => ({ useAppThemeContext: () => ({ theme: lightTheme }) }));
jest.mock('../../hooks/use-accessible-animation', () => ({ useAccessibleAnimation: () => ({ prefersReducedMotion: true }) }));
jest.mock('../../lib/haptic-feedback', () => ({ useHapticFeedback: () => ({ triggerHaptic: jest.fn() }) }));

const HUNTER = 'hunter-1';
const bounty = {
  id: 'b-1',
  title: 'Mount a TV on the wall',
  status: 'in_progress',
  created_at: '2026-01-01T10:00:00Z',
  amount: 80,
  is_for_honor: false,
  accepted_by: HUNTER,
  poster_id: 'poster-1',
} as any;
const accepted = { id: 'r-1', status: 'accepted', hunter_id: HUNTER, created_at: '2026-01-01T11:00:00Z', accepted_at: '2026-01-02T09:12:00Z' };

function hiredCard(hideAction: boolean) {
  const events = buildBountyThreadEvents({ role: 'hunter', viewerId: HUNTER, bounty, request: accepted } as any);
  const pinned = selectPinnedThreadCard(events, 'hunter');
  expect(pinned?.mode).toBe('your_turn');
  const event = pinned!.event;
  render(
    <InteractiveMessageCard event={event} role="hunter" bounty={bounty} counterpartName="Jordan K." onAction={jest.fn()} hideAction={hideAction} />
  );
  return event;
}

describe('InteractiveMessageCard with a pinned step', () => {
  it('on its own, the card says "Your move"', () => {
    hiredCard(false);
    expect(screen.queryAllByText(/Your move/).length).toBeGreaterThan(0);
  });

  it('pinned: no "Your move" and no button on the timeline card', () => {
    hiredCard(true);
    expect(screen.queryAllByText(/Your move/)).toHaveLength(0);
    expect(screen.queryByLabelText(/Your move/)).toBeNull();
  });
});
