import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import HunterWorkInProgressScreen from '../../app/in-progress/[bountyId]/hunter/work-in-progress';

const mockSend = jest.fn();
const mockConfirm = jest.fn();
const mockReload = jest.fn();
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ bountyId: 'b1' }),
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  // The shared Focus-first workspace layout wraps the screen in one.
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
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

// ── Focus-first workspace dependencies ────────────────────────────────────
// The work screen now reads the resolved lifecycle for its copy; give it the
// real resolver's answer for this test's accepted, in-progress job.
jest.mock('../../hooks/useBountyLifecycle', () => {
  const { resolveBountyLifecycle } = jest.requireActual('../../lib/utils/bounty-lifecycle');
  const bounty = { id: 'b1', title: 'Garden cleanup', status: 'in_progress', amount: 20, user_id: 'poster', accepted_by: 'hunter' };
  const state = resolveBountyLifecycle({ bounty, role: 'hunter', viewerId: 'hunter', requestStatus: 'accepted' });
  const value = {
    bounty, role: 'hunter', state, otherParty: { id: 'poster', name: 'Pat', avatar: null }, applicationCount: 0,
    submission: null, requestStatus: 'accepted', requestRejectionSource: null, requestId: 'r1', hasDispute: false,
    disputeId: null, hasCancellationRequest: false, cancellationRequestedByRole: null, isLoading: false, error: null,
    notFound: false, refresh: async () => {},
  };
  return { useBountyLifecycle: () => value };
});
jest.mock('../../hooks/use-auth-context', () => ({ useAuthContext: () => ({ session: { user: { id: 'hunter' } } }) }));
jest.mock('../../hooks/useJobWorkspaceData', () => ({
  useJobConversation: () => ({ conversationId: null, lastFromOther: null, messages: [], messagesKnown: true, loaded: true, reload: mockReload }),
  useJobProblemRecords: () => ({ cancellation: null, dispute: null }),
}));
jest.mock('../../lib/my-jobs/side-labels-store', () => ({ useWorksBothSides: () => false }));
jest.mock('../../lib/services/focus-analytics', () => ({ trackWorkspacePrimaryTapped: jest.fn() }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('../../components/ui/app-modal', () => ({
  AppModal: ({ visible, children }: { visible: boolean; children: React.ReactNode }) => (visible ? children : null),
}));
jest.mock('../../components/ui/skeleton-loaders', () => ({ HunterDashboardSkeleton: () => null }));
jest.mock('../../components/ui/keyboard-avoiding', () => ({
  KeyboardAwareScrollView: ({ children }: { children: React.ReactNode }) => children,
  // WorkspaceLayout wraps the screen in this so the footer clears the keyboard.
  KeyboardAvoidingScreen: ({ children }: { children: React.ReactNode }) => children,
}));

async function renderWork() {
  const screen = render(<HunterWorkInProgressScreen />);
  await waitFor(() => expect(screen.getByText('Quick message')).toBeTruthy());
  return screen;
}

describe('hunter free-text send protection', () => {
  beforeEach(() => {
    mockSend.mockReset().mockResolvedValue(undefined);
    mockConfirm.mockReset().mockResolvedValue(true);
    mockReload.mockReset();
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
    // Their own word moves the stage, so the job's messages are read again.
    expect(mockReload).toHaveBeenCalledTimes(1);
  });

  it('preserves a cancelled quick-message draft and unlocks retry', async () => {
    mockConfirm.mockResolvedValueOnce(false);
    const screen = await renderWork();
    fireEvent.changeText(screen.getByPlaceholderText('Type a message to the poster...'), 'Pay me using Venmo');
    await act(async () => fireEvent.press(screen.getByLabelText('Send message to poster')));
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockReload).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText('Type a message to the poster...').props.value).toBe('Pay me using Venmo');
    await act(async () => fireEvent.press(screen.getByLabelText('Send message to poster')));
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('blocks synchronous progress-update double taps', async () => {
    const screen = await renderWork();
    fireEvent.press(screen.getByText('Add update'));
    fireEvent.changeText(screen.getByPlaceholderText('Describe your progress...'), 'Garden cleared');
    await act(async () => {
      fireEvent.press(screen.getByText('Post update'));
      fireEvent.press(screen.getByText('Post update'));
    });
    expect(mockConfirm).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith('c1', '📋 Progress Update: Garden cleared', 'hunter');
    expect(mockReload).toHaveBeenCalledTimes(1);
  });

  it('preserves a cancelled progress draft and keeps its form open', async () => {
    mockConfirm.mockResolvedValue(false);
    const screen = await renderWork();
    fireEvent.press(screen.getByText('Add update'));
    fireEvent.changeText(screen.getByPlaceholderText('Describe your progress...'), 'Text me at 415-555-1234');
    await act(async () => fireEvent.press(screen.getByText('Post update')));
    expect(mockSend).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText('Describe your progress...').props.value).toBe('Text me at 415-555-1234');
    expect(screen.getByText('Post update')).toBeTruthy();
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
    expect(mockReload).not.toHaveBeenCalled();
  });
});
