/** Publishing lands on the job's own workspace, stage A ("Your job is posted."). */
import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('app/screens/CreateBounty', () => {
  const { TouchableOpacity } = require('react-native');
  return { CreateBountyFlow: (p: any) => <TouchableOpacity testID="finish" onPress={() => p.onComplete('b1')} /> };
});

import { NeedHelpScreen } from '../../app/tabs/need-help-screen';

it('opens stage A after publishing, over a refreshed feed', () => {
  const setActiveScreen = jest.fn();
  const onBountyPosted = jest.fn();
  render(<NeedHelpScreen activeScreen="postings" setActiveScreen={setActiveScreen} onBountyPosted={onBountyPosted} />);
  fireEvent.press(screen.getByTestId('finish'));
  expect(setActiveScreen).toHaveBeenCalledWith('bounty');
  expect(onBountyPosted).toHaveBeenCalled();
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/postings/[bountyId]', params: { bountyId: 'b1', posted: '1' } });
});
