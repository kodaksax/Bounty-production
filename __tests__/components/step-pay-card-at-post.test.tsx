/**
 * SBA-05: StepPay's side of "a first-time poster saves a card when posting".
 * The decision itself is tested in __tests__/unit/hooks/use-posting-card-gate;
 * here the gate is driven directly, to pin the wiring and the copy:
 *   * the CTA goes through requestPublish, never straight to onNext;
 *   * the copy stays true: still "charged when you accept a hunter", plus
 *     "Nothing is charged now" only when a card will be asked for;
 *   * the card sheet is the card tab of PaymentMethodsModal;
 *   * closing it without a card shows why nothing was posted.
 */

import { fireEvent, render } from '@testing-library/react-native';

jest.mock('../../lib/services/analytics-service', () => ({
  analyticsService: { trackEvent: jest.fn() },
}));
jest.mock('../../lib/wallet-context', () => ({ useWallet: () => ({ balance: 0 }) }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('../../hooks/usePostingPolicy', () => {
  const policy = { honorPostsEnabled: false, minimumAmount: 1 };
  return { __esModule: true, default: () => policy, usePostingPolicy: () => policy };
});

const mockGate = {
  cardStepExpected: false,
  checking: false,
  showCardSheet: false,
  dismissed: false,
  onCardSheetClose: jest.fn(),
  requestPublish: jest.fn(),
};
jest.mock('../../hooks/usePostingCardGate', () => ({ usePostingCardGate: () => mockGate }));

const mockModal = jest.fn();
jest.mock('../../components/payment-methods-modal', () => ({
  PaymentMethodsModal: (props: unknown) => {
    mockModal(props);
    return null;
  },
}));

import { StepPay } from '../../app/screens/CreateBounty/quick/StepPay';

const draft = {
  title: 'Mount my TV',
  description: '',
  amount: 40,
  isForHonor: false,
  category: 'handyman',
  workType: 'in_person',
} as any;

function renderStep(onNext = jest.fn()) {
  return {
    onNext,
    ...render(
      <StepPay
        draft={draft}
        onUpdate={jest.fn()}
        onNext={onNext}
        onBack={jest.fn()}
        step={3}
        totalSteps={3}
        ctaLabel="Post Bounty"
      />
    ),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(mockGate, {
    cardStepExpected: false,
    checking: false,
    showCardSheet: false,
    dismissed: false,
  });
});

it('routes the CTA through the card gate with the typed payment and onNext', () => {
  const { getByText, onNext } = renderStep();
  fireEvent.press(getByText('Post Bounty'));
  expect(mockGate.requestPublish).toHaveBeenCalledWith({ amount: 40, isForHonor: false }, onNext);
  expect(onNext).not.toHaveBeenCalled();
});

it('validation still runs first: an invalid amount never reaches the gate', () => {
  const { getByText } = render(
    <StepPay
      draft={{ ...draft, amount: 0 }}
      onUpdate={jest.fn()}
      onNext={jest.fn()}
      onBack={jest.fn()}
      step={3}
      totalSteps={3}
      ctaLabel="Post Bounty"
    />
  );
  fireEvent.press(getByText('Post Bounty'));
  expect(mockGate.requestPublish).not.toHaveBeenCalled();
});

it('no card step: unchanged copy and label', () => {
  const { getByText, queryByText } = renderStep();
  expect(getByText("You're charged when you accept a hunter.")).toBeTruthy();
  expect(getByText('Post Bounty')).toBeTruthy();
  expect(queryByText(/Save a card to post/)).toBeNull();
});

it('card step expected: says a card is needed and that nothing is charged now', () => {
  mockGate.cardStepExpected = true;
  const { getByText, queryByText } = renderStep();
  // Still true: the charge happens at hire.
  expect(getByText("You're charged when you accept a hunter.")).toBeTruthy();
  expect(
    getByText("Save a card to post. Nothing is charged now. It's ready when you hire, so hiring takes one tap.")
  ).toBeTruthy();
  expect(getByText('Add card & post')).toBeTruthy();
  expect(queryByText('Post Bounty')).toBeNull();
});

it('opens the card tab of the payment methods sheet, closing through the gate', () => {
  mockGate.showCardSheet = true;
  renderStep();
  expect(mockModal).toHaveBeenCalled();
  const props = mockModal.mock.calls[mockModal.mock.calls.length - 1][0];
  expect(props).toMatchObject({ isOpen: true, preferredType: 'card' });
  props.onClose();
  props.onBackdropPress();
  expect(mockGate.onCardSheetClose).toHaveBeenCalledTimes(2);
});

it('no sheet unless the gate asks for it', () => {
  renderStep();
  expect(mockModal).not.toHaveBeenCalled();
});

it('closing the sheet with no card explains why nothing was posted', () => {
  mockGate.dismissed = true;
  const { getByText } = renderStep();
  expect(getByText("Save a card to post this bounty. You won't be charged until you hire someone.")).toBeTruthy();
});
