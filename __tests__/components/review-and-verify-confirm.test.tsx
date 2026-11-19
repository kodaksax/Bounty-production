/**
 * app/postings/[bountyId]/review-and-verify used to be a second review screen
 * whose "Approve and continue to payment" released money (first with no
 * confirmation, later behind an Alert). There is now one review flow,
 * PosterReviewModal on the job page, and this route only forwards old links
 * there with ?openReview=work. These tests pin that it can never release
 * anything itself.
 */
import { render } from '@testing-library/react-native';
import fs from 'fs';
import path from 'path';
import React from 'react';

const mockReplace = jest.fn();
let mockParams: Record<string, string | undefined> = { bountyId: 'b-1' };

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => mockParams,
}));
jest.mock('../../components/ui/screen-loader', () => {
  const { Text } = require('react-native');
  return { ScreenLoader: ({ label }: { label?: string }) => <Text>{label}</Text> };
});

import ReviewAndVerifyRedirect from '../../app/postings/[bountyId]/review-and-verify';

beforeEach(() => {
  mockReplace.mockClear();
  mockParams = { bountyId: 'b-1' };
});

describe('review-and-verify (retired) forwards to the one review flow', () => {
  it('replaces itself with the job page, asking it to open the work review', () => {
    const screen = render(<ReviewAndVerifyRedirect />);
    expect(mockReplace).toHaveBeenCalledWith({
      pathname: '/postings/[bountyId]',
      params: { bountyId: 'b-1', openReview: 'work' },
    });
    expect(screen.getByText('Opening the work to check…')).toBeTruthy();
  });

  it('goes home when the link has no job id', () => {
    mockParams = {};
    render(<ReviewAndVerifyRedirect />);
    expect(mockReplace).toHaveBeenCalledWith('/tabs/bounty-app');
  });

  it('contains no release path of its own', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../app/postings/[bountyId]/review-and-verify.tsx'),
      'utf8'
    );
    for (const forbidden of ['approveAndRelease', 'releaseFunds', 'releaseBountyPayment', 'bountyService.update']) {
      expect(src).not.toContain(forbidden);
    }
  });
});

describe('payout page never releases unfinished work', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../app/postings/[bountyId]/payout.tsx'), 'utf8');

  it('hands any job that is not completed to the job page review', () => {
    expect(src).toContain("if (data.status !== 'completed')");
    expect(src).toContain("openReview: 'work'");
  });

  it('has no switch-and-button release of its own any more', () => {
    for (const forbidden of ['handleReleasePayout', 'releaseFunds(', 'releaseBountyPayment(', 'confirmRelease', 'handleMarkComplete']) {
      expect(src).not.toContain(forbidden);
    }
  });
});
