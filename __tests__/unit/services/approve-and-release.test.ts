import { approveAndRelease } from '../../../lib/services/completion-approval';

describe('approveAndRelease', () => {
  test('calls approve before release and notifies hunter', async () => {
    const calls: string[] = [];

    const releaseFn = jest.fn(async () => {
      calls.push('release');
      return true;
    });
    const approveFn = jest.fn(async () => {
      calls.push('approve');
      return true;
    });
    const notifyFn = jest.fn(async () => {
      calls.push('notify');
    });

    const ok = await approveAndRelease({
      bountyId: 'b1',
      hunterId: 'h1',
      title: 't1',
      isForHonor: false,
      releaseFn,
      approveFn,
      notifyFn,
    });

    expect(ok).toBe(true);
    expect(releaseFn).toHaveBeenCalled();
    expect(approveFn).toHaveBeenCalled();
    expect(notifyFn).toHaveBeenCalled();
    // Ensure order
    expect(calls).toEqual(['approve', 'release', 'notify']);
  });

  test('reverts approve when release fails after approval', async () => {
    const calls: string[] = [];

    const releaseFn = jest.fn(async () => {
      calls.push('release');
      return false;
    });
    const approveFn = jest.fn(async () => {
      calls.push('approve');
      return true;
    });
    const revertApproveFn = jest.fn(async () => {
      calls.push('revert-approve');
      return true;
    });
    const notifyFn = jest.fn(async () => {
      calls.push('notify');
    });

    const ok = await approveAndRelease({
      bountyId: 'b2',
      hunterId: 'h2',
      title: 't2',
      isForHonor: false,
      releaseFn,
      approveFn,
      revertApproveFn,
      notifyFn,
    });

    expect(ok).toBe(false);
    expect(approveFn).toHaveBeenCalled();
    expect(releaseFn).toHaveBeenCalled();
    expect(revertApproveFn).toHaveBeenCalled();
    expect(notifyFn).not.toHaveBeenCalled();
    expect(calls).toEqual(['approve', 'release', 'revert-approve']);
  });

  test('attempts refund handler when post-approve paid-flow errors throw', async () => {
    const approveFn = jest.fn(async () => true);
    const releaseFn = jest.fn(async () => {
      throw new Error('release transport timeout');
    });
    const refundReleaseFn = jest.fn(async () => true);

    await expect(
      approveAndRelease({
        bountyId: 'b3',
        hunterId: 'h3',
        title: 't3',
        isForHonor: false,
        releaseFn,
        approveFn,
        refundReleaseFn,
      })
    ).rejects.toThrow('release transport timeout');

    expect(approveFn).toHaveBeenCalled();
    expect(releaseFn).toHaveBeenCalled();
    expect(refundReleaseFn).toHaveBeenCalledWith('b3', 'h3', 't3');
  });
});
