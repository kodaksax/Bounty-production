import { act, renderHook } from '@testing-library/react-native';

import { useBountyForm } from '../../../hooks/useBountyForm';
import { bountyService } from '../../../lib/services/bounty-service';

jest.mock('../../../lib/services/bounty-service', () => ({
  bountyService: {
    create: jest.fn(),
    delete: jest.fn(),
  },
}));

jest.mock('../../../lib/utils/error-logger', () => ({
  logger: {
    info: jest.fn(),
    warning: jest.fn(),
    error: jest.fn(),
  },
}));

describe('useBountyForm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('ignores a second submit while the first bounty creation is in flight', async () => {
    let resolveCreate: (value: any) => void = () => {};
    (bountyService.create as jest.Mock).mockReturnValue(
      new Promise((resolve) => {
        resolveCreate = resolve;
      })
    );

    const setActiveScreen = jest.fn();
    const setMyBounties = jest.fn();
    const onBountyPosted = jest.fn();
    const onError = jest.fn();

    const { result } = renderHook(() =>
      useBountyForm({
        currentUserId: 'user-123',
        balance: 0,
        createEscrow: jest.fn(),
        isEmailVerified: true,
        onBountyPosted,
        setActiveScreen,
        setMyBounties,
        onError,
      })
    );

    act(() => {
      result.current.setFormData((prev) => ({
        ...prev,
        title: 'Fix duplicate submit',
        description: 'The submit action should only create one bounty.',
        isForHonor: true,
        workType: 'online',
      }));
    });

    let firstSubmit: Promise<void>;
    let secondSubmit: Promise<void>;

    act(() => {
      firstSubmit = result.current.handlePostBounty();
      secondSubmit = result.current.handlePostBounty();
    });

    expect(bountyService.create).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveCreate({
        id: 'bounty-1',
        title: 'Fix duplicate submit',
        amount: 0,
        is_for_honor: true,
        status: 'open',
      });
      await Promise.all([firstSubmit, secondSubmit]);
    });

    expect(onError).not.toHaveBeenCalled();
    expect(onBountyPosted).toHaveBeenCalledTimes(1);
    expect(setActiveScreen).toHaveBeenCalledWith('bounty');
  });
});
