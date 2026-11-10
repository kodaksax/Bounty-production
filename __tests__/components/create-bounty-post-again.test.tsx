/**
 * "Post again" in the composer (app/screens/CreateBounty/index.tsx) and its
 * host (app/tabs/need-help-screen.tsx).
 *
 * The draft arrives complete, so the composer opens on Compensation: the
 * poster checks the price and taps Post, with Back still reaching Location and
 * Task. The publish goes out with the same text, address and amount, and
 * reports publish_type 'republish'.
 */

import { act, fireEvent, render, screen } from '@testing-library/react-native';

let mockDraft: any;

jest.mock('react-native-reanimated', () => {
  const RN = require('react-native');
  const chainable = (): any => {
    const obj: any = {};
    obj.duration = () => obj;
    obj.delay = () => obj;
    obj.springify = () => obj;
    return obj;
  };
  return {
    __esModule: true,
    default: {
      View: RN.View,
      Text: RN.Text,
      Image: RN.Image,
      ScrollView: RN.ScrollView,
      createAnimatedComponent: (c: unknown) => c,
    },
    View: RN.View,
    Text: RN.Text,
    FadeIn: chainable(),
    FadeInDown: chainable(),
  };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: jest.fn(() => ({ top: 0, bottom: 0, left: 0, right: 0 })),
}));
jest.mock('hooks/useBackHandler', () => ({ useBackHandler: jest.fn() }));
jest.mock('app/hooks/useBountyDraft', () => ({
  useBountyDraft: jest.fn(() => ({
    draft: mockDraft,
    saveDraft: jest.fn(),
    clearDraft: jest.fn(),
    isLoading: false,
  })),
}));
jest.mock('hooks/use-auth-context', () => ({
  useAuthContext: jest.fn(() => ({ session: { access_token: 'token', user: { id: 'poster-1' } } })),
}));
jest.mock('hooks/use-email-verification', () => ({
  useEmailVerification: jest.fn(() => ({
    isEmailVerified: true,
    canPostBounties: true,
    userEmail: 'poster@example.com',
  })),
}));
jest.mock('lib/wallet-context', () => ({
  useWallet: jest.fn(() => ({ balance: 100, createEscrow: jest.fn() })),
}));
jest.mock('lib/stripe-context', () => ({
  useStripe: jest.fn(() => ({ paymentMethods: [{ id: 'pm_test' }] })),
}));
jest.mock('lib/utils/payment-architecture', () => ({
  shouldFundNewBountiesWithPhase2: jest.fn(() => false),
  shouldUseStripeNativeFunding: jest.fn(() => false),
}));
jest.mock('lib/services/analytics-service', () => ({ analyticsService: { trackEvent: jest.fn() } }));
jest.mock('app/services/bountyService', () => ({
  bountyService: { createBounty: jest.fn(), deleteBounty: jest.fn() },
}));
jest.mock('lib/services/bounty-payments-service', () => ({
  bountyPaymentsService: { createBountyPayment: jest.fn(), cancelBountyPayment: jest.fn() },
}));
jest.mock('lib/services/offline-queue-service', () => ({
  offlineQueueService: { getOnlineStatus: jest.fn(() => true) },
}));
jest.mock('lib/services/stripe-service', () => ({ stripeService: { confirmPaymentSecure: jest.fn() } }));
jest.mock('hooks/useFormSubmission', () => ({
  // Runs the real publish handler, so a tap on Post reaches createBounty.
  useFormSubmission: jest.fn((handler: () => Promise<void>) => ({
    submit: () => handler(),
    isSubmitting: false,
    error: null,
    reset: jest.fn(),
  })),
}));

const stepStub = (name: string) => (props: any) => {
  const { TouchableOpacity, Text, View } = require('react-native');
  return (
    <View>
      <Text>{name}</Text>
      <TouchableOpacity accessibilityLabel="stub-next" onPress={() => props.onNext()}>
        <Text>Next</Text>
      </TouchableOpacity>
      {props.onBack && (
        <TouchableOpacity accessibilityLabel="stub-back" onPress={props.onBack}>
          <Text>Back</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};
jest.mock('app/screens/CreateBounty/quick/StepTask', () => ({ StepTask: stepStub('StepTask') }));
jest.mock('app/screens/CreateBounty/quick/StepWhere', () => ({ StepWhere: stepStub('StepWhere') }));
jest.mock('app/screens/CreateBounty/quick/StepPay', () => ({
  StepPay: (props: any) => {
    const { TouchableOpacity, Text, View } = require('react-native');
    return (
      <View>
        <Text>StepPay</Text>
        <Text>{`$${props.draft.amount}`}</Text>
        <TouchableOpacity
          accessibilityLabel="stub-post"
          onPress={() => props.onNext({ amount: props.draft.amount, isForHonor: props.draft.isForHonor })}
        >
          <Text>Post Bounty</Text>
        </TouchableOpacity>
        <TouchableOpacity accessibilityLabel="stub-back" onPress={props.onBack}>
          <Text>Back</Text>
        </TouchableOpacity>
      </View>
    );
  },
}));
jest.mock('app/screens/CreateBounty/quick/StepPhotos', () => ({ StepPhotos: () => null }));
jest.mock('app/screens/CreateBounty/quick/StepWhen', () => ({ StepWhen: () => null }));
jest.mock('app/screens/CreateBounty/quick/PostCelebration', () => ({ PostCelebration: () => null }));
jest.mock('app/screens/CreateBounty/quick/StepPostPublish', () => ({
  StepPostPublish: () => {
    const { Text } = require('react-native');
    return <Text>StepPostPublish</Text>;
  },
}));
jest.mock('components/add-money-screen', () => ({ AddMoneyScreen: () => null }));

import { CreateBountyFlow } from 'app/screens/CreateBounty/index';
import { bountyService } from 'app/services/bountyService';
import { analyticsService } from 'lib/services/analytics-service';

const trackEvent = analyticsService.trackEvent as jest.Mock;
const eventsNamed = (name: string) => trackEvent.mock.calls.filter((c) => c[0] === name).map((c) => c[1]);

/** What buildDraftFromBounty makes of a cancelled trash-removal bounty. */
const republishDraft = {
  title: 'Haul away yard trash',
  description: 'Six bags of yard waste and an old grill by the side gate.',
  category: 'labor',
  workType: 'in_person',
  amount: 45,
  isForHonor: false,
  location: '1200 S 1st St, Austin, TX 78704',
  latitude: 30.2513,
  longitude: -97.7543,
  unit: 'Apt 4',
  zipCode: '78704',
  attachments: [],
  trustTier: 'standard',
  requiresIdVerified: false,
  republishedFrom: 'b-cancelled',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockDraft = { ...republishDraft };
  (bountyService.createBounty as jest.Mock).mockResolvedValue({ bounty: { id: 'b-new' }, created: true });
});

describe('CreateBountyFlow — Post again', () => {
  it('opens on Compensation with the amount filled in, and no resume prompt', () => {
    render(<CreateBountyFlow startStep={3} entryPoint="post_again" deliberateTap />);

    expect(screen.getByText('StepPay')).toBeTruthy();
    expect(screen.getByText('$45')).toBeTruthy();
    expect(screen.queryByTestId('resume-draft-banner')).toBeNull();
    expect(eventsNamed('composer_opened')).toEqual([
      expect.objectContaining({ entry_point: 'post_again', composer_screen: 'composer_pay' }),
    ]);
    expect(eventsNamed('bounty_started')).toEqual([
      expect.objectContaining({ trigger: 'post_again', resumed_draft: false, entry_point: 'post_again' }),
    ]);
  });

  it('still lets Back reach Location and Task', () => {
    render(<CreateBountyFlow startStep={3} entryPoint="post_again" />);

    fireEvent.press(screen.getByLabelText('stub-back'));
    expect(screen.getByText('StepWhere')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('stub-back'));
    expect(screen.getByText('StepTask')).toBeTruthy();
  });

  it('publishes the same text, address and amount as a republish', async () => {
    render(<CreateBountyFlow startStep={3} entryPoint="post_again" deliberateTap />);

    await act(async () => {
      fireEvent.press(screen.getByLabelText('stub-post'));
    });

    expect(bountyService.createBounty).toHaveBeenCalledTimes(1);
    expect((bountyService.createBounty as jest.Mock).mock.calls[0][0]).toMatchObject({
      title: 'Haul away yard trash',
      description: 'Six bags of yard waste and an old grill by the side gate.',
      location: '1200 S 1st St, Austin, TX 78704',
      latitude: 30.2513,
      longitude: -97.7543,
      unit: 'Apt 4',
      zipCode: '78704',
      amount: 45,
    });
    expect(eventsNamed('bounty_published')).toEqual([
      expect.objectContaining({
        bounty_id: 'b-new',
        publish_type: 'republish',
        republished_from_bounty_id: 'b-cancelled',
      }),
    ]);
  });

  it('still reports an ordinary post as new', async () => {
    const { republishedFrom: _drop, ...plain } = republishDraft;
    mockDraft = plain;
    render(<CreateBountyFlow startStep={3} />);

    await act(async () => {
      fireEvent.press(screen.getByLabelText('stub-post'));
    });

    expect(eventsNamed('bounty_published')).toEqual([
      expect.objectContaining({ publish_type: 'new', republished_from_bounty_id: undefined }),
    ]);
  });

  it('opens on step 1 without a start step, as before', () => {
    render(<CreateBountyFlow />);
    expect(screen.getByText('StepTask')).toBeTruthy();
  });
});

describe('NeedHelpScreen — Post again request', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { NeedHelpScreen } = require('app/tabs/need-help-screen');
  const props = { activeScreen: 'postings', setActiveScreen: jest.fn() };

  it('remounts the composer on the request and opens it on its step', () => {
    const view = render(<NeedHelpScreen {...props} isActive={false} />);
    expect(screen.getByText('StepTask')).toBeTruthy();

    view.rerender(
      <NeedHelpScreen {...props} isActive={false} postAgain={{ nonce: 1, startStep: 3 }} entryPoint="post_again" />
    );
    expect(screen.getByText('StepPay')).toBeTruthy();
  });

  it('starts at step 1 again once the poster leaves the tab', () => {
    const view = render(
      <NeedHelpScreen {...props} isActive postAgain={{ nonce: 1, startStep: 3 }} entryPoint="post_again" />
    );
    expect(screen.getByText('StepPay')).toBeTruthy();

    view.rerender(<NeedHelpScreen {...props} isActive={false} postAgain={{ nonce: 1, startStep: 3 }} />);
    expect(screen.getByText('StepTask')).toBeTruthy();
    view.rerender(<NeedHelpScreen {...props} isActive postAgain={{ nonce: 1, startStep: 3 }} />);
    expect(screen.getByText('StepTask')).toBeTruthy();
  });

  it('opens a second Post again on its step too', () => {
    const view = render(
      <NeedHelpScreen {...props} isActive postAgain={{ nonce: 1, startStep: 3 }} entryPoint="post_again" />
    );
    view.rerender(<NeedHelpScreen {...props} isActive={false} postAgain={{ nonce: 1, startStep: 3 }} />);
    view.rerender(<NeedHelpScreen {...props} isActive={false} postAgain={{ nonce: 2, startStep: 3 }} />);
    expect(screen.getByText('StepPay')).toBeTruthy();
  });
});
