/**
 * Senior-first poster audit (2026-11-14), fix 1: a job's "Contact support"
 * pushed /tabs/need-help-screen, whose default export is the Post-a-Bounty
 * composer. It now opens /support/contact: the real ContactSupportScreen
 * form, carrying the job, and closable like any other screen.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import fs from 'fs';
import path from 'path';
import React from 'react';
import { Alert } from 'react-native';
import { lightTheme } from '../../lib/themes/lightTheme';

let mockParams: Record<string, string> = {};
let mockCanGoBack = true;
const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockSubmit = jest.fn();

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({ push: jest.fn(), replace: mockReplace, back: mockBack, canGoBack: () => mockCanGoBack }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../../lib/themes/AppThemeContext', () => ({ useAppThemeContext: () => ({ theme: lightTheme }) }));
jest.mock('../../lib/services/feedback-service', () => ({
  SUPPORT_SUBJECT_MAX_LENGTH: 200,
  feedbackService: { submitSupportRequest: (...a: unknown[]) => mockSubmit(...a) },
}));
jest.mock('expo-image-picker', () => ({}));

import ContactSupportRoute from '../../app/support/contact';

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockParams = {};
  mockCanGoBack = true;
  mockSubmit.mockResolvedValue({ success: true });
});

describe('/support/contact', () => {
  it('is the support form, with the job named, not the job composer', () => {
    mockParams = { bountyId: 'b1', bountyTitle: 'Remove old furniture from my garage' };
    render(<ContactSupportRoute />);
    expect(screen.getByText('Contact Support')).toBeTruthy();
    expect(screen.getByTestId('contact-support-job-context').props.children).toBe(
      'About your job: Remove old furniture from my garage'
    );
    expect(screen.getByLabelText('Subject').props.value).toBe('Help with "Remove old furniture from my garage"');
    expect(screen.getByText('Send Message')).toBeTruthy();
  });

  it('sends the job id along with the message', async () => {
    mockParams = { bountyId: 'b1', bountyTitle: 'Remove old furniture from my garage' };
    render(<ContactSupportRoute />);
    fireEvent.changeText(screen.getByLabelText('Details'), 'The helper never showed up.');
    fireEvent.press(screen.getByText('Send Message'));
    await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1));
    const { subject, message } = mockSubmit.mock.calls[0][0];
    expect(subject).toBe('Help with "Remove old furniture from my garage"');
    expect(message).toContain('The helper never showed up.');
    expect(message).toContain('Job ID: b1');
    expect(message).toContain('Job: "Remove old furniture from my garage"');
  });

  it('opened without a job, it is the plain form', () => {
    render(<ContactSupportRoute />);
    expect(screen.queryByTestId('contact-support-job-context')).toBeNull();
    expect(screen.getByLabelText('Subject').props.value).toBe('');
  });

  it('can be closed: back goes back, or home when there is nothing to go back to', () => {
    mockParams = { bountyId: 'b1' };
    const { unmount } = render(<ContactSupportRoute />);
    fireEvent.press(screen.getByLabelText('Back'));
    expect(mockBack).toHaveBeenCalledTimes(1);
    unmount();

    mockCanGoBack = false;
    render(<ContactSupportRoute />);
    fireEvent.press(screen.getByLabelText('Back'));
    expect(mockReplace).toHaveBeenCalledWith('/tabs/bounty-app');
  });
});

describe('job screens route "Contact support" to the form', () => {
  // The lifecycle's contact_support handlers on both job screens. A source
  // check, so a future edit can't quietly point either back at the composer.
  it.each([
    'app/postings/[bountyId]/index.tsx',
    'app/in-progress/[bountyId]/hunter/index.tsx',
  ])('%s', file => {
    const src = fs.readFileSync(path.join(__dirname, '../../', file), 'utf8');
    const handler = src.slice(src.indexOf('contact_support:'), src.indexOf('contact_support:') + 300);
    expect(handler).toContain("pathname: '/support/contact'");
    expect(handler).toContain('bountyId: routeBountyId');
    expect(handler).not.toContain('need-help-screen');
  });
});
