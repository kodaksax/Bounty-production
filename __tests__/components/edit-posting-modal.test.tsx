import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { EditPostingModal } from '../../components/edit-posting-modal';
import { Bounty } from '../../lib/services/database.types';

// Mock dependencies
jest.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: jest.fn(() => ({ top: 0, bottom: 0, left: 0, right: 0 })),
}));

const mockBounty: Bounty = {
    id: '1',
    title: 'Original Title',
    description: 'Original Description',
    amount: 50,
    is_for_honor: false,
    location: 'Original Location',
    status: 'open',
    poster_id: 'user_1',
    created_at: new Date().toISOString(),
    timeline: '',
    skills_required: '',
};

describe('EditPostingModal', () => {
    const onSave = jest.fn();
    const onClose = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('renders correctly and pre-populates with bounty data', () => {
        const { getByDisplayValue, getByText } = render(
            <EditPostingModal
                visible={true}
                bounty={mockBounty}
                onSave={onSave}
                onClose={onClose}
            />
        );

        expect(getByDisplayValue('Original Title')).toBeTruthy();
        expect(getByDisplayValue('Original Description')).toBeTruthy();
        expect(getByDisplayValue('50')).toBeTruthy();
        expect(getByDisplayValue('Original Location')).toBeTruthy();
    });

    it('synchronizes state when bounty prop changes', async () => {
        const { getByDisplayValue, rerender } = render(
            <EditPostingModal
                visible={true}
                bounty={mockBounty}
                onSave={onSave}
                onClose={onClose}
            />
        );

        const updatedBounty = {
            ...mockBounty,
            title: 'Updated Title',
            amount: 100,
        };

        rerender(
            <EditPostingModal
                visible={true}
                bounty={updatedBounty}
                onSave={onSave}
                onClose={onClose}
            />
        );

        await waitFor(() => {
            expect(getByDisplayValue('Updated Title')).toBeTruthy();
            expect(getByDisplayValue('100')).toBeTruthy();
        });
    });

    it('validates that amount > 0 for paid bounties', async () => {
        const { getByText, getByDisplayValue } = render(
            <EditPostingModal
                visible={true}
                bounty={mockBounty}
                onSave={onSave}
                onClose={onClose}
            />
        );

        const amountInput = getByDisplayValue('50');
        fireEvent.changeText(amountInput, '0');

        const saveButton = getByText('Save Changes');
        fireEvent.press(saveButton);

        await waitFor(() => {
            expect(getByText('Amount must be greater than 0')).toBeTruthy();
            expect(onSave).not.toHaveBeenCalled();
        });
    });

    it('allows amount of 0 for For Honor bounties', async () => {
        const honorBounty = {
            ...mockBounty,
            is_for_honor: true,
            amount: 0,
        };

        const { getByText, queryByText } = render(
            <EditPostingModal
                visible={true}
                bounty={honorBounty}
                onSave={onSave}
                onClose={onClose}
            />
        );

        const saveButton = getByText('Save Changes');
        fireEvent.press(saveButton);

        await waitFor(() => {
            expect(queryByText('Amount must be greater than 0')).toBeNull();
            expect(onSave).toHaveBeenCalled();
        });
    });

    it('handles 0 amount in paid bounty by showing empty string in input initially', () => {
        const zeroPaidBounty = {
            ...mockBounty,
            amount: 0,
        };

        const { getByPlaceholderText } = render(
            <EditPostingModal
                visible={true}
                bounty={zeroPaidBounty}
                onSave={onSave}
                onClose={onClose}
            />
        );

        const amountInput = getByPlaceholderText('0');
        expect(amountInput.props.value).toBe('');
    });
});
