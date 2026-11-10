/**
 * Contract for the composer drop-off events (composerTelemetry.ts): what each
 * step reports for a tap on Next, a first keystroke and a blocking message.
 * Follows step-task-template-contract.test.tsx: the real step screens, with
 * only analytics and the network-facing services mocked.
 */
import { AccessibilityInfo } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import React, { useState } from 'react';

// InfoTooltip calls this; the RN jest preset's mock omits it.
(AccessibilityInfo as unknown as { announceForAccessibility: jest.Mock }).announceForAccessibility =
  jest.fn();

const mockTrackEvent = jest.fn();
jest.mock('../../lib/services/analytics-service', () => ({
  analyticsService: {
    trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
  },
}));

let mockPlacesEnabled = false;
const mockSearchAddresses = jest.fn();
const mockGeocodeAddress = jest.fn();
jest.mock('../../lib/services/address-autocomplete-service', () => ({
  addressAutocompleteService: {
    isConfigured: () => mockPlacesEnabled,
    searchAddresses: (...args: unknown[]) => mockSearchAddresses(...args),
    getPlaceDetails: jest.fn(),
  },
  isPlaceDetailsError: () => false,
}));
jest.mock('../../lib/services/location-service', () => ({
  locationService: {
    getPermissionStatus: jest.fn(),
    requestPermission: jest.fn(),
    getCurrentLocation: jest.fn(),
    geocodeAddress: (...args: unknown[]) => mockGeocodeAddress(...args),
    reverseGeocodeDetailed: jest.fn().mockResolvedValue(null),
  },
}));

jest.mock('../../lib/wallet-context', () => ({
  useWallet: jest.fn(() => ({ balance: 0 })),
}));
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));
jest.mock('../../hooks/usePostingPolicy', () => {
  const policy = { honorPostsEnabled: true, minimumAmount: 1 };
  return { __esModule: true, default: () => policy, usePostingPolicy: () => policy };
});
let mockCardGateChecking = false;
jest.mock('../../hooks/usePostingCardGate', () => ({
  usePostingCardGate: () => ({
    cardStepExpected: false,
    checking: mockCardGateChecking,
    showCardSheet: false,
    dismissed: false,
    onCardSheetClose: () => {},
    requestPublish: (payment: unknown, proceed: (p: unknown) => void) => proceed(payment),
  }),
}));
jest.mock('../../components/payment-methods-modal', () => ({ PaymentMethodsModal: () => null }));

import { createComposerTelemetry } from '../../app/screens/CreateBounty/composerTelemetry';
import { StepPay } from '../../app/screens/CreateBounty/quick/StepPay';
import { StepTask } from '../../app/screens/CreateBounty/quick/StepTask';
import { StepWhere } from '../../app/screens/CreateBounty/quick/StepWhere';
import { CONTACT_INFO_ERROR } from '../../lib/utils/bounty-validation';

const DETAIL_LABEL = 'What exactly, and when?';
const TITLE_LABEL = 'What do you need done?';
const TWENTY = 'One 30-minute walk!!';
const BLOCKED_TAP = 'blocked-tap-capture';

const eventsNamed = (name: string) =>
  mockTrackEvent.mock.calls.filter((c) => c[0] === name).map((c) => c[1]);

function baseDraft(overrides: Record<string, unknown> = {}) {
  return {
    title: '',
    description: '',
    amount: 0,
    isForHonor: false,
    category: 'other',
    workType: 'in_person',
    location: '',
    ...overrides,
  } as any;
}

/** A parent that applies onUpdate, so edits and template taps re-render. */
function StepTaskHarness({
  telemetry,
  initial = {},
  onNext = jest.fn(),
}: {
  telemetry?: ReturnType<typeof createComposerTelemetry>;
  initial?: Record<string, unknown>;
  onNext?: () => void;
}) {
  const [draft, setDraft] = useState(baseDraft(initial));
  return (
    <StepTask
      draft={draft}
      onUpdate={(patch) => setDraft((d: any) => ({ ...d, ...patch }))}
      onNext={onNext}
      telemetry={telemetry}
      step={1}
      totalSteps={3}
    />
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPlacesEnabled = false;
  mockCardGateChecking = false;
});

describe('post_next_tapped on Task (step 1)', () => {
  it('records a tap on the disabled button without advancing or enabling it', () => {
    const onNext = jest.fn();
    const { getByLabelText, getByTestId } = render(
      <StepTaskHarness
        telemetry={createComposerTelemetry()}
        initial={{ title: 'Walk my dog', description: 'Saturday 9am' }}
        onNext={onNext}
      />
    );

    fireEvent.press(getByTestId(BLOCKED_TAP));

    expect(onNext).not.toHaveBeenCalled();
    expect(getByLabelText('Next').props.accessibilityState).toEqual({ disabled: true });
    expect(eventsNamed('post_next_tapped')).toEqual([
      {
        step_name: 'Task',
        step_index: 1,
        blocked: true,
        missing_field: 'description',
        detail_length: 12,
        title_source: 'template',
        template_id: 'walk_dog',
        composer_screen: 'composer_task',
      },
    ]);
  });

  it.each([
    ['title', { title: '', description: TWENTY }],
    ['description', { title: 'Fix my bike chain', description: '' }],
    ['contact', { title: 'Fix my bike chain', description: 'Saturday morning, text me at 410-555-1212' }],
  ])('names %s as the field stopping Next', (missingField, initial) => {
    const { getByTestId } = render(
      <StepTaskHarness telemetry={createComposerTelemetry()} initial={initial} />
    );
    fireEvent.press(getByTestId(BLOCKED_TAP));
    expect(eventsNamed('post_next_tapped')[0]).toMatchObject({
      blocked: true,
      missing_field: missingField,
    });
  });

  it('records an enabled tap and advances, with no overlay in the way', () => {
    const onNext = jest.fn();
    const { getByLabelText, queryByTestId } = render(
      <StepTaskHarness
        telemetry={createComposerTelemetry()}
        initial={{ title: 'Fix my bike chain', description: TWENTY }}
        onNext={onNext}
      />
    );

    expect(queryByTestId(BLOCKED_TAP)).toBeNull();
    fireEvent.press(getByLabelText('Next'));

    expect(onNext).toHaveBeenCalledTimes(1);
    expect(eventsNamed('post_next_tapped')).toEqual([
      expect.objectContaining({
        blocked: false,
        missing_field: null,
        detail_length: 20,
        title_source: 'typed',
        template_id: null,
      }),
    ]);
  });

  it('sends nothing without telemetry (a preloaded, off-screen flow)', () => {
    const { getByLabelText, getByTestId } = render(<StepTaskHarness initial={{ title: 'Walk my dog' }} />);
    // The blocked tap still guides the poster to the missing field; it just
    // isn't reported.
    fireEvent.press(getByTestId(BLOCKED_TAP));
    fireEvent.changeText(getByLabelText(DETAIL_LABEL), 'x');
    expect(eventsNamed('post_next_tapped')).toEqual([]);
    expect(eventsNamed('post_detail_typed')).toEqual([]);
    expect(eventsNamed('post_validation_shown')).toEqual([]);
  });
});

describe('first keystroke events', () => {
  it('post_detail_typed fires once per composer session, across step remounts', () => {
    const telemetry = createComposerTelemetry();
    const first = render(<StepTaskHarness telemetry={telemetry} initial={{ title: 'Walk my dog' }} />);

    fireEvent.changeText(first.getByLabelText(DETAIL_LABEL), 'S');
    fireEvent.changeText(first.getByLabelText(DETAIL_LABEL), 'Sa');
    first.unmount();
    const second = render(<StepTaskHarness telemetry={telemetry} initial={{ title: 'Walk my dog' }} />);
    fireEvent.changeText(second.getByLabelText(DETAIL_LABEL), 'Sat');

    expect(eventsNamed('post_detail_typed')).toEqual([
      {
        step_index: 1,
        title_source: 'template',
        template_id: 'walk_dog',
        composer_screen: 'composer_task',
      },
    ]);
  });

  it('post_title_first_typed fires once and leaves post_title_typed alone', () => {
    const { getByLabelText } = render(<StepTaskHarness telemetry={createComposerTelemetry()} />);

    fireEvent.changeText(getByLabelText(TITLE_LABEL), 'F');
    fireEvent.changeText(getByLabelText(TITLE_LABEL), 'Fi');

    expect(eventsNamed('post_title_first_typed')).toEqual([
      { step_index: 1, title_source: 'typed', template_id: null, composer_screen: 'composer_task' },
    ]);
    expect(eventsNamed('post_title_typed')).toEqual([]);
  });

  it('a template tap is not a keystroke', () => {
    const { getByLabelText } = render(<StepTaskHarness telemetry={createComposerTelemetry()} />);
    fireEvent.press(getByLabelText('Walk my dog, suggested $20'));
    expect(eventsNamed('post_title_first_typed')).toEqual([]);
    expect(eventsNamed('post_detail_typed')).toEqual([]);
  });
});

describe('post_validation_shown on Task', () => {
  it('fires for the template-tap case: title filled, details under 20 characters', () => {
    const { getByLabelText } = render(<StepTaskHarness telemetry={createComposerTelemetry()} />);
    expect(eventsNamed('post_validation_shown')).toEqual([]);

    fireEvent.press(getByLabelText('Walk my dog, suggested $20'));

    expect(eventsNamed('post_validation_shown')).toEqual([
      { field: 'description', rule: 'min_length', composer_screen: 'composer_task' },
    ]);
  });

  it('fires once per field and rule per composer session', () => {
    const telemetry = createComposerTelemetry();
    const first = render(<StepTaskHarness telemetry={telemetry} initial={{ title: 'Walk my dog' }} />);
    fireEvent.changeText(first.getByLabelText(DETAIL_LABEL), 'Sat');
    fireEvent.changeText(first.getByLabelText(DETAIL_LABEL), 'Satu');
    first.unmount();
    render(<StepTaskHarness telemetry={telemetry} initial={{ title: 'Walk my dog' }} />);

    expect(eventsNamed('post_validation_shown')).toHaveLength(1);
  });

  it('stays silent until a title exists', () => {
    const { getByLabelText } = render(<StepTaskHarness telemetry={createComposerTelemetry()} />);

    fireEvent.changeText(getByLabelText(DETAIL_LABEL), 'text me at 410-555-1212 please');
    expect(eventsNamed('post_validation_shown')).toEqual([]);

    fireEvent.changeText(getByLabelText(TITLE_LABEL), 'Fix my bike chain');
    expect(eventsNamed('post_validation_shown')).toEqual([
      expect.objectContaining({ field: 'contact', rule: 'contact_info' }),
    ]);
  });

  it('fires contact_info when the contact error is on screen', () => {
    const { getByText } = render(
      <StepTaskHarness
        telemetry={createComposerTelemetry()}
        initial={{ title: 'Fix my bike chain', description: 'Saturday morning, text me at 410-555-1212' }}
      />
    );
    expect(getByText(CONTACT_INFO_ERROR)).toBeTruthy();
    expect(eventsNamed('post_validation_shown')).toEqual([
      { field: 'contact', rule: 'contact_info', composer_screen: 'composer_task' },
    ]);
  });

  it('does not report a hidden min-length error when contact information takes precedence', () => {
    const { getByLabelText } = render(
      <StepTaskHarness
        telemetry={createComposerTelemetry()}
        initial={{ title: 'A'.repeat(91), description: '410-555-1212' }}
      />
    );

    fireEvent(getByLabelText(DETAIL_LABEL), 'blur');

    expect(eventsNamed('post_validation_shown')).toEqual([
      { field: 'contact', rule: 'contact_info', composer_screen: 'composer_task' },
    ]);
  });

  it('fires the title rule only once the title error shows, after blur', () => {
    const { getByLabelText } = render(
      <StepTaskHarness telemetry={createComposerTelemetry()} initial={{ title: 'abc', description: TWENTY }} />
    );
    expect(eventsNamed('post_validation_shown')).toEqual([]);

    fireEvent(getByLabelText(TITLE_LABEL), 'blur');

    expect(eventsNamed('post_validation_shown')).toEqual([
      { field: 'title', rule: 'title', composer_screen: 'composer_task' },
    ]);
  });
});

describe('composer_screen and trust_content_viewed on Task', () => {
  it('tags the template events', () => {
    const { getByLabelText } = render(<StepTaskHarness telemetry={createComposerTelemetry()} />);
    fireEvent.press(getByLabelText('Walk my dog, suggested $20'));
    expect(eventsNamed('category_selected')[0]).toMatchObject({ composer_screen: 'composer_task' });
    expect(eventsNamed('post_chip_tapped')[0]).toMatchObject({ composer_screen: 'composer_task' });
  });

  it('the "How a bounty works" tooltip sends trust_content_viewed and keeps post_help_opened', () => {
    const { getByLabelText } = render(<StepTaskHarness telemetry={createComposerTelemetry()} />);

    fireEvent.press(getByLabelText('Help: How a bounty works'));

    expect(eventsNamed('trust_content_viewed')).toEqual([
      { topic: 'how_it_works', surface: 'composer_task', composer_screen: 'composer_task', term: 'bounty' },
    ]);
    expect(eventsNamed('post_help_opened')).toEqual([
      { surface: 'create_flow', step_index: 1, term: 'bounty', composer_screen: 'composer_task' },
    ]);
  });
});

describe('Location (step 2)', () => {
  const renderWhere = (draft: Record<string, unknown>, withTelemetry = true) => {
    const onNext = jest.fn();
    const utils = render(
      <StepWhere
        draft={baseDraft({ title: 'Fix my bike chain', description: TWENTY, ...draft })}
        onUpdate={jest.fn()}
        onNext={onNext}
        onBack={jest.fn()}
        telemetry={withTelemetry ? createComposerTelemetry() : undefined}
        step={2}
        totalSteps={3}
      />
    );
    return { ...utils, onNext };
  };

  it('records a tap on disabled Continue as location_required', () => {
    const { getByTestId, onNext } = renderWhere({ location: '' });

    fireEvent.press(getByTestId(BLOCKED_TAP));

    expect(onNext).not.toHaveBeenCalled();
    expect(eventsNamed('post_next_tapped')).toEqual([
      expect.objectContaining({
        step_name: 'Location',
        step_index: 2,
        blocked: true,
        missing_field: 'location',
        composer_screen: 'composer_location',
      }),
    ]);
    expect(eventsNamed('post_validation_shown')).toEqual([
      { field: 'location', rule: 'location_required', composer_screen: 'composer_location' },
    ]);
  });

  it('advances an online bounty with blocked: false', () => {
    const { getByLabelText, onNext } = renderWhere({ workType: 'online' });
    fireEvent.press(getByLabelText('Continue'));
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(eventsNamed('post_next_tapped')[0]).toMatchObject({ blocked: false, missing_field: null });
  });

  it('reports blocked once an address fails to resolve', async () => {
    mockGeocodeAddress.mockResolvedValue(null);
    const { getByLabelText, onNext } = renderWhere({ location: 'Nowhere at all' });

    await act(async () => {
      fireEvent.press(getByLabelText('Continue'));
    });

    expect(onNext).not.toHaveBeenCalled();
    expect(eventsNamed('post_next_tapped')).toEqual([
      expect.objectContaining({ blocked: true, missing_field: 'location' }),
    ]);
    expect(eventsNamed('post_validation_shown')).toEqual([
      { field: 'location', rule: 'address_unresolved', composer_screen: 'composer_location' },
    ]);
  });

  it('counts "pick a suggestion" as address_unresolved', async () => {
    mockPlacesEnabled = true;
    mockSearchAddresses.mockResolvedValue([
      { id: 'p1', placeId: 'p1', description: '1 Main St', mainText: '1 Main St' },
    ]);
    const { getByLabelText } = renderWhere({ location: '1 Main' });

    await act(async () => {
      fireEvent.press(getByLabelText('Continue'));
    });

    expect(eventsNamed('post_validation_shown')).toEqual([
      expect.objectContaining({ rule: 'address_unresolved' }),
    ]);
  });

  it('reports blocked: false once a typed address resolves', async () => {
    mockGeocodeAddress.mockResolvedValue({ latitude: 39, longitude: -76 });
    const { getByLabelText, onNext } = renderWhere({ location: '1 Main St, Baltimore' });

    await act(async () => {
      fireEvent.press(getByLabelText('Continue'));
    });

    await waitFor(() => expect(onNext).toHaveBeenCalledTimes(1));
    expect(eventsNamed('post_next_tapped')).toEqual([
      expect.objectContaining({ blocked: false, missing_field: null }),
    ]);
    expect(eventsNamed('post_validation_shown')).toEqual([]);
  });

  it('sends nothing when editing a live bounty (no telemetry)', () => {
    const { queryByTestId } = renderWhere({ location: '' }, false);
    expect(queryByTestId(BLOCKED_TAP)).toBeNull();
    expect(eventsNamed('post_next_tapped')).toEqual([]);
  });
});

describe('Compensation (step 3): validation runs on tap', () => {
  const renderPay = (draft: Record<string, unknown> = {}) => {
    const onNext = jest.fn();
    const utils = render(
      <StepPay
        draft={baseDraft({ title: 'Fix my bike chain', ...draft })}
        onUpdate={jest.fn()}
        onNext={onNext}
        onBack={jest.fn()}
        telemetry={createComposerTelemetry()}
        step={3}
        totalSteps={3}
        ctaLabel="Post Bounty"
      />
    );
    return { ...utils, onNext };
  };

  it('fires blocked: true with min_amount when the amount is too low', () => {
    const { getByLabelText, onNext } = renderPay({ amount: 0 });

    fireEvent.press(getByLabelText('Post Bounty'));

    expect(onNext).not.toHaveBeenCalled();
    expect(eventsNamed('post_next_tapped')).toEqual([
      expect.objectContaining({
        step_name: 'Compensation',
        step_index: 3,
        blocked: true,
        missing_field: 'amount',
        composer_screen: 'composer_pay',
      }),
    ]);
    expect(eventsNamed('post_validation_shown')).toEqual([
      { field: 'amount', rule: 'min_amount', composer_screen: 'composer_pay' },
    ]);
  });

  it('does not call an over-maximum amount a minimum-amount failure', () => {
    const { getByLabelText } = renderPay({ amount: 20000 });
    fireEvent.press(getByLabelText('Post Bounty'));
    expect(eventsNamed('post_next_tapped')[0]).toMatchObject({ blocked: true, missing_field: 'amount' });
    expect(eventsNamed('post_validation_shown')).toEqual([]);
  });

  it('fires blocked: true with contact_info when the text carries contact details', () => {
    const { getByLabelText, onNext } = renderPay({
      amount: 40,
      description: 'Saturday morning, text me at 410-555-1212',
    });

    fireEvent.press(getByLabelText('Post Bounty'));

    expect(onNext).not.toHaveBeenCalled();
    expect(eventsNamed('post_next_tapped')[0]).toMatchObject({ blocked: true, missing_field: 'contact' });
    expect(eventsNamed('post_validation_shown')).toEqual([
      { field: 'contact', rule: 'contact_info', composer_screen: 'composer_pay' },
    ]);
  });

  it('fires blocked: false on a passing tap, before amount_set', () => {
    const { getByLabelText, onNext } = renderPay({ amount: 40 });

    fireEvent.press(getByLabelText('Post Bounty'));

    expect(onNext).toHaveBeenCalledTimes(1);
    const names = mockTrackEvent.mock.calls.map((c) => c[0]);
    expect(names.indexOf('post_next_tapped')).toBeLessThan(names.indexOf('amount_set'));
    expect(eventsNamed('post_next_tapped')[0]).toMatchObject({ blocked: false, missing_field: null });
    expect(eventsNamed('amount_set')[0]).toMatchObject({ composer_screen: 'composer_pay' });
  });

  it('records a tap while a check is in flight as blocked with no missing field', () => {
    mockCardGateChecking = true;
    const { getByTestId, onNext } = renderPay({ amount: 40 });

    fireEvent.press(getByTestId(BLOCKED_TAP));

    expect(onNext).not.toHaveBeenCalled();
    expect(eventsNamed('post_next_tapped')).toEqual([
      expect.objectContaining({ blocked: true, missing_field: null }),
    ]);
  });
});
