/**
 * Persistence/hydration coverage for BountyFormatProvider — the same
 * context Settings and the onboarding style step both read from. Confirms
 * every format (including 'compact') round-trips through AsyncStorage
 * correctly, since this is the "applied immediately + persists across app
 * restarts" leg of the onboarding bug report.
 */
import React from 'react';
import { render, act, fireEvent } from '@testing-library/react-native';
import { Text, TouchableOpacity } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BountyFormatProvider, useBountyFormat, type BountyFormat } from '../../../lib/bounty-format-context';

const STORAGE_KEY = 'bounty_display_format';

function FormatConsumer() {
  const { bountyFormat, setBountyFormat } = useBountyFormat();
  return (
    <>
      <Text testID="format">{bountyFormat}</Text>
      <TouchableOpacity testID="set-card" onPress={() => setBountyFormat('card')} />
      <TouchableOpacity testID="set-compact" onPress={() => setBountyFormat('compact')} />
      <TouchableOpacity testID="set-grid" onPress={() => setBountyFormat('grid')} />
    </>
  );
}

describe('BountyFormatProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
  });

  it('defaults to card before AsyncStorage resolves', async () => {
    const { getByTestId } = render(
      <BountyFormatProvider>
        <FormatConsumer />
      </BountyFormatProvider>
    );
    expect(getByTestId('format').props.children).toBe('card');
  });

  it.each<BountyFormat>(['card', 'compact', 'grid'])(
    'hydrates a previously-stored %s preference on mount',
    async (stored) => {
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(stored);

      const { getByTestId } = render(
        <BountyFormatProvider>
          <FormatConsumer />
        </BountyFormatProvider>
      );

      await act(async () => {
        await Promise.resolve();
      });

      expect(getByTestId('format').props.children).toBe(stored);
    }
  );

  it('selecting Compact updates the applied value immediately and persists the exact string "compact"', async () => {
    const { getByTestId } = render(
      <BountyFormatProvider>
        <FormatConsumer />
      </BountyFormatProvider>
    );

    await act(async () => {
      fireEvent.press(getByTestId('set-compact'));
      await Promise.resolve();
    });

    // Applied immediately (context value updates synchronously with state).
    expect(getByTestId('format').props.children).toBe('compact');
    // Persisted under the same key/value Settings and onboarding both read.
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(STORAGE_KEY, 'compact');
  });

  it('selecting card then compact then grid persists each distinct value (no cross-option regression)', async () => {
    const { getByTestId } = render(
      <BountyFormatProvider>
        <FormatConsumer />
      </BountyFormatProvider>
    );

    for (const [testId, expected] of [
      ['set-card', 'card'],
      ['set-compact', 'compact'],
      ['set-grid', 'grid'],
    ] as const) {
      await act(async () => {
        fireEvent.press(getByTestId(testId));
        await Promise.resolve();
      });
      expect(getByTestId('format').props.children).toBe(expected);
      expect(AsyncStorage.setItem).toHaveBeenLastCalledWith(STORAGE_KEY, expected);
    }
  });

  it('ignores a corrupt/unrecognized stored value and falls back to the card default', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue('not-a-real-format');

    const { getByTestId } = render(
      <BountyFormatProvider>
        <FormatConsumer />
      </BountyFormatProvider>
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(getByTestId('format').props.children).toBe('card');
  });
});
