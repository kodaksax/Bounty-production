import { approveAndRelease } from '../../../lib/services/completion-approval'

describe('approveAndRelease', () => {
  test('calls release before approve and notifies hunter', async () => {
    const calls: string[] = []

    const releaseFn = jest.fn(async () => { calls.push('release'); return true })
    const approveFn = jest.fn(async () => { calls.push('approve'); return true })
    const notifyFn = jest.fn(async () => { calls.push('notify'); })

    const ok = await approveAndRelease({
      bountyId: 'b1',
      hunterId: 'h1',
      title: 't1',
      isForHonor: false,
      releaseFn,
      approveFn,
      notifyFn,
    })

    expect(ok).toBe(true)
    expect(releaseFn).toHaveBeenCalled()
    expect(approveFn).toHaveBeenCalled()
    expect(notifyFn).toHaveBeenCalled()
    // Ensure order
    expect(calls).toEqual(['release', 'approve', 'notify'])
  })

  test('does not call approve when release fails', async () => {
    const calls: string[] = []

    const releaseFn = jest.fn(async () => { calls.push('release'); return false })
    const approveFn = jest.fn(async () => { calls.push('approve'); return true })
    const notifyFn = jest.fn(async () => { calls.push('notify'); })

    const ok = await approveAndRelease({
      bountyId: 'b2',
      hunterId: 'h2',
      title: 't2',
      isForHonor: false,
      releaseFn,
      approveFn,
      notifyFn,
    })

    expect(ok).toBe(false)
    expect(releaseFn).toHaveBeenCalled()
    expect(approveFn).not.toHaveBeenCalled()
    expect(notifyFn).not.toHaveBeenCalled()
    expect(calls).toEqual(['release'])
  })
})
