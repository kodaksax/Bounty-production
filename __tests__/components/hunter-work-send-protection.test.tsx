import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import HunterWorkInProgressScreen from '../../app/in-progress/[bountyId]/hunter/work-in-progress';

const mockSend = jest.fn();
const mockConfirm = jest.fn();
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ bountyId: 'b1' }),
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../../hooks/useSafeBack', () => ({ useSafeBack: () => jest.fn(), FEED_FALLBACK: '/' }));
jest.mock('../../hooks/use-chat-send-protection', () => ({
  useChatSendProtection: () => mockConfirm,
  useChatSendScope: jest.requireActual('../../hooks/use-chat-send-protection').useChatSendScope,
}));
jest.mock('../../hooks/useBountyExactLocation', () => ({
  useBountyExactLocation: () => ({ exact: null }),
  formatExactAddress: () => null,
}));
jest.mock('../../lib/utils/data-utils', () => ({ getCurrentUserId: () => 'hunter' }));
jest.mock('../../lib/services/bounty-service', () => ({
  bountyService: {
    getById: async () => ({
      id: 'b1', title: 'Garden cleanup', status: 'in_progress', amount: 20,
      user_id: 'poster', accepted_by: 'hunter', created_at: '2026-10-04T00:00:00Z',
    }),
  },
}));
jest.mock('../../lib/services/bounty-request-service', () => ({
  bountyRequestService: { getAll: async () => [{ id: 'r1', status: 'accepted' }] },
}));
jest.mock('../../lib/services/message-service', () => ({
  messageService: {
    getConversations: async () => [{ id: 'c1', bountyId: 'b1' }],
    sendMessage: (...args: unknown[]) => mockSend(...args),
  },
}));
jest.mock('../../lib/services/dispute-service', () => ({ disputeService: {} }));
jest.mock('../../components/workflow-dispute-modal', () => ({ WorkflowDisputeModal: () => null }));
jest.mock('../../components/ui/skeleton-loaders', () => ({ HunterDashboardSkeleton: () => null }));
jest.mock('../../components/ui/keyboard-avoiding', () => ({
  KeyboardAwareScrollView: ({ children }: { children: React.ReactNode }) => children,
}));

async function renderWork() {
  const screen = render(<HunterWorkInProgressScreen />);
  await waitFor(() => expect(screen.getByText('Quick Message')).toBeTruthy());
  return screen;
}

describe('hunter free-text send protection', () => {
  beforeEach(() => {
    mockSend.mockReset().mockResolvedValue(undefined);
    mockConfirm.mockReset().mockResolvedValue(true);
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  it('blocks synchronous quick-message double taps across the confirmation microtask', async () => {
    const screen = await renderWork();
    fireEvent.changeText(screen.getByPlaceholderText('Type a message to the poster...'), 'Garden cleared');
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Send message to poster'));
      fireEvent.press(screen.getByLabelText('Send message to poster'));
    });
    expect(mockConfirm).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith('c1', 'Garden cleared');
  });

  it('preserves a cancelled quick-message draft and unlocks retry', async () => {
    mockConfirm.mockResolvedValueOnce(false);
    const screen = await renderWork();
    fireEvent.changeText(screen.getByPlaceholderText('Type a message to the poster...'), 'Pay me using Venmo');
    await act(async () => fireEvent.press(screen.getByLabelText('Send message to poster')));
    expect(mockSend).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText('Type a message to the poster...').props.value).toBe('Pay me using Venmo');
    await act(async () => fireEvent.press(screen.getByLabelText('Send message to poster')));
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('blocks synchronous progress-update double taps', async () => {
    const screen = await renderWork();
    fireEvent.press(screen.getByText('Add Update'));
    fireEvent.changeText(screen.getByPlaceholderText('Describe your progress...'), 'Garden cleared');
    await act(async () => {
      fireEvent.press(screen.getByText('Post Update'));
      fireEvent.press(screen.getByText('Post Update'));
    });
    expect(mockConfirm).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith('c1', '📋 Progress Update: Garden cleared', 'hunter');
  });

  it('preserves a cancelled progress draft and keeps its form open', async () => {
    mockConfirm.mockResolvedValue(false);
    const screen = await renderWork();
    fireEvent.press(screen.getByText('Add Update'));
    fireEvent.changeText(screen.getByPlaceholderText('Describe your progress...'), 'Text me at 415-555-1234');
    await act(async () => fireEvent.press(screen.getByText('Post Update')));
    expect(mockSend).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText('Describe your progress...').props.value).toBe('Text me at 415-555-1234');
    expect(screen.getByText('Post Update')).toBeTruthy();
  });

  it('does not send a confirmed draft after leaving the work screen', async () => {
    let approve!: (approved: boolean) => void;
    mockConfirm.mockImplementation(() => new Promise<boolean>(resolve => { approve = resolve; }));
    const screen = await renderWork();
    fireEvent.changeText(screen.getByPlaceholderText('Type a message to the poster...'), 'Pay me via Venmo');
    fireEvent.press(screen.getByLabelText('Send message to poster'));
    screen.unmount();
    await act(async () => { approve(true); });
    expect(mockSend).not.toHaveBeenCalled();
  });
});
