/**
 * MomentSheet can always be closed (2026-11-17): a close button, Android back
 * and a backdrop tap all count as "Later". An explicit no is offered only when
 * the moment has one, and retires it instead.
 */
import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@expo/vector-icons', () => ({ MaterialIcons: () => null }));

let mockModalProps: any = null;
jest.mock('../../../components/ui/app-modal', () => ({
  AppModal: (props: any) => {
    mockModalProps = props;
    return props.visible ? require('react').createElement('View', {}, props.children) : null;
  },
}));

const mockDismiss = jest.fn();
const mockDecline = jest.fn();
const mockAccept = jest.fn();
let mockContent: any = null;
jest.mock('../../../providers/moments-provider', () => ({
  useMoments: () => ({
    activeMoment: mockContent ? { type: 'enable_notifications' } : null,
    activeContent: mockContent,
    accept: mockAccept,
    dismiss: mockDismiss,
    decline: mockDecline,
  }),
}));

import { MomentSheet } from '../../../components/moments/MomentSheet';

const CONTENT = {
  title: 'Hear when someone applies',
  body: 'Your bounty is live.',
  primaryLabel: 'Turn on notifications',
  secondaryLabel: 'Not now',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockModalProps = null;
  mockContent = CONTENT;
});

describe('MomentSheet', () => {
  it('has a close button that answers "Later"', () => {
    const { getByLabelText } = render(<MomentSheet />);
    fireEvent.press(getByLabelText('Close'));
    expect(mockDismiss).toHaveBeenCalledTimes(1);
    expect(mockDecline).not.toHaveBeenCalled();
  });

  it('closes on Android back and on a backdrop tap, as "Later"', () => {
    render(<MomentSheet />);
    expect(mockModalProps.dismissable).toBe(true);
    mockModalProps.onRequestClose(); // back button and backdrop both land here
    expect(mockDismiss).toHaveBeenCalledTimes(1);
  });

  it('"Not now" is "Later" too', () => {
    const { getByText } = render(<MomentSheet />);
    fireEvent.press(getByText('Not now'));
    expect(mockDismiss).toHaveBeenCalledTimes(1);
  });

  it('offers an explicit no only when the moment has one, and it retires the moment', () => {
    const { queryByTestId, rerender, getByText } = render(<MomentSheet />);
    expect(queryByTestId('moment-sheet-decline')).toBeNull();

    mockContent = { ...CONTENT, declineLabel: "Don't ask again" };
    rerender(<MomentSheet />);
    fireEvent.press(getByText("Don't ask again"));
    expect(mockDecline).toHaveBeenCalledTimes(1);
    expect(mockDismiss).not.toHaveBeenCalled();
  });
});
