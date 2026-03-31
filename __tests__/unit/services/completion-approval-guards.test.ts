/**
 * Extended tests for approveAndRelease
 * Covers new guard validations for missing identifiers
 */

import { approveAndRelease } from '../../../lib/services/completion-approval'

// Mock monitoring to suppress logs
jest.mock('../../../lib/services/monitoring', () => ({
  logClientError: jest.fn(),
  logClientInfo: jest.fn(),
}))

describe('approveAndRelease – input guards', () => {
  it('returns false when bountyId is empty string', async () => {
    const releaseFn = jest.fn(async () => true)
    const approveFn = jest.fn(async () => true)

    const result = await approveAndRelease({
      bountyId: '',
      hunterId: 'h1',
      title: 't1',
      releaseFn,
      approveFn,
    })

    expect(result).toBe(false)
    expect(releaseFn).not.toHaveBeenCalled()
    expect(approveFn).not.toHaveBeenCalled()
  })

  it('returns false when hunterId is empty string', async () => {
    const releaseFn = jest.fn(async () => true)
    const approveFn = jest.fn(async () => true)

    const result = await approveAndRelease({
      bountyId: 'b1',
      hunterId: '',
      title: 't1',
      releaseFn,
      approveFn,
    })

    expect(result).toBe(false)
    expect(releaseFn).not.toHaveBeenCalled()
    expect(approveFn).not.toHaveBeenCalled()
  })

  it('skips release for honor bounties but still approves', async () => {
    const calls: string[] = []

    const releaseFn = jest.fn(async () => { calls.push('release'); return true })
    const approveFn = jest.fn(async () => { calls.push('approve'); return true })

    const result = await approveAndRelease({
      bountyId: 'b1',
      hunterId: 'h1',
      title: 't1',
      isForHonor: true,
      releaseFn,
      approveFn,
    })

    expect(result).toBe(true)
    expect(releaseFn).not.toHaveBeenCalled()
    expect(approveFn).toHaveBeenCalled()
    expect(calls).toEqual(['approve'])
  })
})
