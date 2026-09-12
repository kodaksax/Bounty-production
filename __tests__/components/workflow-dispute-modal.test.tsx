import { fireEvent, render } from '@testing-library/react-native'
import { WorkflowDisputeModal } from '../../components/workflow-dispute-modal'

jest.mock('../../hooks/use-attachment-upload', () => ({
  useAttachmentUpload: () => ({ pickAttachment: jest.fn() }),
}))

jest.mock('../../lib/services/dispute-service', () => ({
  disputeService: {},
}))

jest.mock('../../lib/themes/AppThemeContext', () => ({
  useAppThemeContext: () => ({
    theme: {
      isDark: true,
      background: '#000',
      border: '#333',
      primary: '#059669',
      surfaceSecondary: '#111',
      text: '#fff',
      textSecondary: '#aaa',
      textDisabled: '#666',
    },
  }),
}))

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}))

describe('WorkflowDisputeModal', () => {
  it('scrolls to the custom details field when the keyboard opens', () => {
    const { UNSAFE_root } = render(
      <WorkflowDisputeModal
        visible
        bountyId="bounty-id"
        bountyTitle="Bounty"
        initiatorId="initiator-id"
        respondentId="respondent-id"
        stage="in_progress"
        onClose={jest.fn()}
        onDisputeCreated={jest.fn()}
      />,
    )

    fireEvent.press(UNSAFE_root.findByProps({ children: 'Continue' }))

    const detailsInput = UNSAFE_root.findByProps({
      placeholder: 'Describe the issue in detail (minimum 20 characters)...',
    })

    expect(detailsInput.props.onFocus).toEqual(expect.any(Function))
  })
})
