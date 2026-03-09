import {
    getInsufficientBalanceMessage,
    validateAmount,
    validateBalance,
    validateDescription,
    validateTitle,
} from '../../../lib/utils/bounty-validation'

describe('bounty validation utils', () => {
  test('validateTitle empty and length checks', () => {
    expect(validateTitle('')).toBe('Title is required')
    expect(validateTitle('  ')).toBe('Title is required')
    expect(validateTitle('abc')).toBe('Title must be at least 5 characters')
    const long = 'a'.repeat(121)
    expect(validateTitle(long)).toBe('Title must not exceed 120 characters')
    expect(validateTitle('Valid title')).toBeNull()
  })

  test('validateBalance honors honor bounties', () => {
    expect(validateBalance(100, 0, true)).toBe(true)
    expect(validateBalance(50, 100, false)).toBe(true)
    expect(validateBalance(150, 100, false)).toBe(false)
  })

  test('insufficient balance message formatting', () => {
    const msg = getInsufficientBalanceMessage(25, 5)
    expect(msg).toContain('$25')
    expect(msg).toContain('$5.00')
  })

  test('validateDescription length and required', () => {
    expect(validateDescription('')).toBe('Description is required')
    expect(validateDescription('short description')).toContain('Description must be at least')
    const valid = 'a'.repeat(20)
    expect(validateDescription(valid)).toBeNull()
  })

  test('validateAmount honor and numeric bounds', () => {
    expect(validateAmount(0, true)).toBeNull()
    expect(validateAmount(-1, true)).toBe('Amount must be at least $0')
    expect(validateAmount(1, true)).toBe('Honor bounties must have a $0 amount')

    expect(validateAmount(NaN, false)).toBe('Please enter a valid amount')
    expect(validateAmount(0.5, false)).toBe('The minimum bounty amount is $1.00')
    expect(validateAmount(10001, false)).toBe('The maximum bounty amount is $10,000.00')
    expect(validateAmount(50, false)).toBeNull()
  })
})
