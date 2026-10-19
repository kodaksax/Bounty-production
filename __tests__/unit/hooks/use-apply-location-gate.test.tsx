/**
 * SBA-02: before applying to in-person work, a hunter with no saved location
 * is asked for a ZIP. Online jobs, hunters with a saved point, and a failed
 * lookup all go straight through.
 */
import { act, renderHook } from '@testing-library/react-native';

const mockGetMyCoordinates = jest.fn();
jest.mock('../../../lib/services/bounty-location-service', () => ({
  getMyCoordinates: (...a: any[]) => mockGetMyCoordinates(...a),
}));
const mockTrack = jest.fn();
jest.mock('../../../lib/services/analytics-service', () => ({
  analyticsService: { trackEvent: (...a: any[]) => mockTrack(...a) },
}));

import { useApplyLocationGate } from '../../../hooks/useApplyLocationGate';

beforeEach(() => jest.clearAllMocks());

const setup = () => renderHook(() => useApplyLocationGate('hunter-1'));

it('never asks for an online job', async () => {
  const { result } = setup();
  const proceed = jest.fn();
  await act(() => result.current.run({ bountyId: 'b1', workType: 'online' }, proceed));
  expect(proceed).toHaveBeenCalledTimes(1);
  expect(mockGetMyCoordinates).not.toHaveBeenCalled();
  expect(result.current.visible).toBe(false);
});

it('goes straight through when the profile has a saved point, and remembers it', async () => {
  mockGetMyCoordinates.mockResolvedValue({ ok: true, coords: { latitude: 1, longitude: 2 } });
  const { result } = setup();
  const proceed = jest.fn();
  await act(() => result.current.run({ bountyId: 'b1', workType: 'in_person' }, proceed));
  await act(() => result.current.run({ bountyId: 'b2', workType: 'in_person' }, proceed));
  expect(proceed).toHaveBeenCalledTimes(2);
  expect(mockGetMyCoordinates).toHaveBeenCalledTimes(1);
  expect(result.current.visible).toBe(false);
});

it('does not block on a failed lookup', async () => {
  mockGetMyCoordinates.mockResolvedValue({ ok: false });
  const { result } = setup();
  const proceed = jest.fn();
  await act(() => result.current.run({ bountyId: 'b1', workType: 'in_person' }, proceed));
  expect(proceed).toHaveBeenCalledTimes(1);
  expect(result.current.visible).toBe(false);
});

it('asks for a ZIP when there is no saved point, and continues once saved', async () => {
  mockGetMyCoordinates.mockResolvedValue({ ok: true, coords: null });
  const { result } = setup();
  const proceed = jest.fn();
  await act(() => result.current.run({ bountyId: 'b1', workType: 'in_person' }, proceed));
  expect(proceed).not.toHaveBeenCalled();
  expect(result.current.visible).toBe(true);
  expect(mockTrack).toHaveBeenCalledWith('apply_location_prompt_shown', { bounty_id: 'b1' });

  act(() => result.current.onSaved({ geocoded: true }));
  expect(proceed).toHaveBeenCalledTimes(1);
  expect(result.current.visible).toBe(false);
  expect(mockTrack).toHaveBeenCalledWith('apply_location_saved', { bounty_id: 'b1', geocoded: true });
});

it('cancelling backs out of applying', async () => {
  mockGetMyCoordinates.mockResolvedValue({ ok: true, coords: null });
  const { result } = setup();
  const proceed = jest.fn();
  await act(() => result.current.run({ bountyId: 'b1', workType: 'in_person' }, proceed));
  act(() => result.current.onCancel());
  expect(proceed).not.toHaveBeenCalled();
  expect(result.current.visible).toBe(false);
  expect(mockTrack).toHaveBeenCalledWith('apply_location_prompt_cancelled', { bounty_id: 'b1' });
});
