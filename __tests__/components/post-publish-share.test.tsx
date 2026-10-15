import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { BountyDraft } from '../../app/hooks/useBountyDraft';
import { StepPostPublish } from '../../app/screens/CreateBounty/quick/StepPostPublish';

jest.mock('@expo/vector-icons', () => ({ MaterialIcons: () => null }));
jest.mock('../../lib/themes/AppThemeContext', () => ({
  useAppThemeContext: () => ({ theme: require('../../lib/themes/lightTheme').lightTheme }),
}));
jest.mock('../../app/screens/CreateBounty/quick/QuickStepLayout', () => ({
  QuickStepLayout: ({ children, onCta }: any) => {
    const { View, TouchableOpacity, Text } = require('react-native');
    return (
      <View>
        {children}
        <TouchableOpacity accessibilityLabel="Continue" onPress={onCta}>
          <Text>Continue</Text>
        </TouchableOpacity>
      </View>
    );
  },
}));

const draft = {
  title: 'A task',
  description: '',
  amount: 20,
  workType: 'in_person',
  attachments: [],
} as unknown as BountyDraft;
const label = 'Share your bounty with friends or your local community';

describe('post-publish share control', () => {
  it('keeps sharing optional and Continue available', () => {
    const onContinue = jest.fn();
    render(<StepPostPublish draft={draft} onAddDetail={jest.fn()} onContinue={onContinue} step={3} totalSteps={3} />);
    expect(screen.queryByLabelText(label)).toBeNull();
    fireEvent.press(screen.getByLabelText('Continue'));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('does not share automatically and guards repeated taps until the sheet resolves', async () => {
    let finish!: () => void;
    const onShare = jest.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    render(<StepPostPublish draft={draft} onAddDetail={jest.fn()} onContinue={jest.fn()} onShare={onShare} step={3} totalSteps={3} />);
    expect(onShare).not.toHaveBeenCalled();
    fireEvent.press(screen.getByLabelText(label));
    fireEvent.press(screen.getByLabelText(label));
    expect(onShare).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText(label).props.accessibilityState).toEqual({ disabled: true, busy: true });
    await act(async () => { finish(); });
    expect(screen.getByLabelText(label).props.accessibilityState).toEqual({ disabled: false, busy: false });
    fireEvent.press(screen.getByLabelText(label));
    expect(onShare).toHaveBeenCalledTimes(2);
    await act(async () => { finish(); });
  });
});
