/**
 * NeedHelpScreen (the Post tab): a post_first cold start opens the composer
 * without anyone choosing Post, so that one arrival is not a deliberate tap
 * (no composer_opened); every other arrival still is.
 */

import { render } from '@testing-library/react-native';
import React from 'react';

const mockFlow = jest.fn();
jest.mock('app/screens/CreateBounty', () => ({
  CreateBountyFlow: (props: any) => {
    mockFlow(props);
    return null;
  },
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

import { NeedHelpScreen } from '../../app/tabs/need-help-screen';

const renderScreen = (entryPoint?: string) =>
  render(<NeedHelpScreen activeScreen="postings" setActiveScreen={jest.fn()} entryPoint={entryPoint} />);

beforeEach(() => mockFlow.mockClear());

it('an app_launch arrival is not a deliberate tap', () => {
  renderScreen('app_launch');
  expect(mockFlow).toHaveBeenCalledWith(
    expect.objectContaining({ entryPoint: 'app_launch', deliberateTap: false })
  );
});

it.each([undefined, 'home_post_card', 'moment_post_first_bounty'])(
  'arriving via %s stays deliberate',
  entryPoint => {
    renderScreen(entryPoint);
    expect(mockFlow).toHaveBeenCalledWith(expect.objectContaining({ deliberateTap: true }));
  }
);
