import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

const mockSearchAddresses = jest.fn();
const mockGetPlaceDetails = jest.fn();
const mockGeocodeAddress = jest.fn();
const mockReverseGeocodeDetailed = jest.fn();

jest.mock('@expo/vector-icons', () => ({ MaterialIcons: () => null }));
jest.mock('../../lib/themes/AppThemeContext', () => ({
  useAppThemeContext: () => ({
    theme: {
      isDark: false,
      text: '#000',
      textSecondary: '#666',
      primary: '#080',
      surfaceSecondary: '#eee',
      border: '#ccc',
      error: '#f00',
      background: '#fff',
    },
  }),
}));
jest.mock('../../lib/services/address-autocomplete-service', () => ({
  addressAutocompleteService: {
    isConfigured: () => true,
    searchAddresses: (...args: unknown[]) => mockSearchAddresses(...args),
    getPlaceDetails: (...args: unknown[]) => mockGetPlaceDetails(...args),
  },
  isPlaceDetailsError: (details: { error?: string }) => Boolean(details.error),
}));
jest.mock('../../lib/services/location-service', () => ({
  locationService: {
    getPermissionStatus: jest.fn(),
    requestPermission: jest.fn(),
    getCurrentLocation: jest.fn(),
    geocodeAddress: (...args: unknown[]) => mockGeocodeAddress(...args),
    reverseGeocodeDetailed: (...args: unknown[]) => mockReverseGeocodeDetailed(...args),
  },
}));
jest.mock('../../app/screens/CreateBounty/quick/QuickStepLayout', () => ({
  QuickStepLayout: ({ children, onCta, ctaLabel, ctaDisabled, ctaBusy }: any) => (
    <View>
      {children}
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={ctaLabel}
        disabled={ctaDisabled || ctaBusy}
        onPress={onCta}
      >
        <Text>{ctaLabel}</Text>
      </TouchableOpacity>
    </View>
  ),
}));

import { StepWhere } from '../../app/screens/CreateBounty/quick/StepWhere';
import type { BountyDraft } from '../../app/hooks/useBountyDraft';

const draft: BountyDraft = {
  title: '',
  description: '',
  amount: 0,
  isForHonor: false,
  location: '',
  workType: 'in_person',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

beforeEach(() => {
  jest.clearAllMocks();
});

test('ignores place details that finish after the address changes', async () => {
  const details = deferred<any>();
  mockSearchAddresses.mockResolvedValue([{
    id: 'place-1',
    placeId: 'place-1',
    description: 'Old address',
    mainText: 'Old address',
  }]);
  mockGetPlaceDetails.mockReturnValue(details.promise);
  const onUpdate = jest.fn();
  const { getByLabelText, findByLabelText } = render(
    <StepWhere draft={draft} onUpdate={onUpdate} onNext={jest.fn()} onBack={jest.fn()} step={3} totalSteps={5} />
  );

  fireEvent.changeText(getByLabelText('ZIP / postal code or address'), 'Old address');
  await waitFor(() => expect(mockSearchAddresses).toHaveBeenCalledWith('Old address'));
  fireEvent.press(await findByLabelText('Select address: Old address'));
  fireEvent.changeText(getByLabelText('ZIP / postal code or address'), 'New address');

  await act(async () => {
    details.resolve({
      formattedAddress: 'Old address, City',
      latitude: 1,
      longitude: 2,
      components: {},
    });
    await details.promise;
  });

  expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({
    location: 'New address',
    latitude: undefined,
    longitude: undefined,
  }));
  expect(onUpdate).not.toHaveBeenCalledWith(expect.objectContaining({ latitude: 1, longitude: 2 }));
});

test('does not geocode or advance when Continue lookup is superseded by an edit', async () => {
  const search = deferred<any[]>();
  mockSearchAddresses.mockReturnValue(search.promise);
  const onNext = jest.fn();
  const { getByLabelText } = render(
    <StepWhere
      draft={{ ...draft, location: 'Old address' }}
      onUpdate={jest.fn()}
      onNext={onNext}
      onBack={jest.fn()}
      step={3}
      totalSteps={5}
    />
  );

  fireEvent.press(getByLabelText('Continue'));
  await waitFor(() => expect(mockSearchAddresses).toHaveBeenCalledWith('Old address'));
  fireEvent.changeText(getByLabelText('ZIP / postal code or address'), 'New address');

  await act(async () => {
    search.resolve([]);
    await search.promise;
  });

  expect(mockGeocodeAddress).not.toHaveBeenCalled();
  expect(onNext).not.toHaveBeenCalled();
});
