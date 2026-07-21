/**
 * Tests for WithdrawMethodSelect — the always-visible Standard vs Instant
 * chooser that replaced the old hidden-until-eligible Instant Cash Out card
 * on the withdraw screen.
 */
import { fireEvent, render } from '@testing-library/react-native';
import { WithdrawMethodSelect } from '../../components/withdraw-method-select';

describe('WithdrawMethodSelect', () => {
  it('always renders both Standard and Instant options', () => {
    const { getByText } = render(
      <WithdrawMethodSelect
        selected="standard"
        onSelect={jest.fn()}
        instantEligible={false}
        onAddDebitCard={jest.fn()}
      />
    );
    expect(getByText('Standard')).toBeTruthy();
    expect(getByText('Instant')).toBeTruthy();
  });

  it('calls onSelect("instant") when Instant is tapped and eligible', () => {
    const onSelect = jest.fn();
    const onAddDebitCard = jest.fn();
    const { getByText } = render(
      <WithdrawMethodSelect
        selected="standard"
        onSelect={onSelect}
        instantEligible
        onAddDebitCard={onAddDebitCard}
      />
    );
    fireEvent.press(getByText('Instant'));
    expect(onSelect).toHaveBeenCalledWith('instant');
    expect(onAddDebitCard).not.toHaveBeenCalled();
  });

  it('calls onAddDebitCard instead of onSelect when Instant is tapped but ineligible', () => {
    const onSelect = jest.fn();
    const onAddDebitCard = jest.fn();
    const { getByText } = render(
      <WithdrawMethodSelect
        selected="standard"
        onSelect={onSelect}
        instantEligible={false}
        onAddDebitCard={onAddDebitCard}
      />
    );
    fireEvent.press(getByText('Instant'));
    expect(onAddDebitCard).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('shows the ineligible reason instead of the fee/ETA copy when not eligible', () => {
    const { getByText, queryByText } = render(
      <WithdrawMethodSelect
        selected="standard"
        onSelect={jest.fn()}
        instantEligible={false}
        instantIneligibleReason="Add a debit card to unlock"
        onAddDebitCard={jest.fn()}
      />
    );
    expect(getByText('Add a debit card to unlock')).toBeTruthy();
    expect(queryByText('~1% fee · Usually minutes')).toBeNull();
  });

  it('shows the fee/ETA copy when eligible', () => {
    const { getByText } = render(
      <WithdrawMethodSelect
        selected="standard"
        onSelect={jest.fn()}
        instantEligible
        onAddDebitCard={jest.fn()}
      />
    );
    expect(getByText('~1% fee · Usually minutes')).toBeTruthy();
  });

  it('always shows Standard as free with no fee copy', () => {
    const { getByText } = render(
      <WithdrawMethodSelect
        selected="standard"
        onSelect={jest.fn()}
        instantEligible
        onAddDebitCard={jest.fn()}
      />
    );
    expect(getByText('Free · 1-3 business days')).toBeTruthy();
  });

  it('tapping Standard calls onSelect("standard")', () => {
    const onSelect = jest.fn();
    const { getByText } = render(
      <WithdrawMethodSelect
        selected="instant"
        onSelect={onSelect}
        instantEligible
        onAddDebitCard={jest.fn()}
      />
    );
    fireEvent.press(getByText('Standard'));
    expect(onSelect).toHaveBeenCalledWith('standard');
  });
});
