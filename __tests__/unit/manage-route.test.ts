import { buildManageRoutePath, safeManageRedirect } from '../../lib/navigation/manage-route'

const BOUNTY = '5e96aaed-93bd-4ade-ae39-93b073d9daff'
const APPLICANT = '0b1c2d3e-4f50-4617-8899-aabbccddeeff'

describe('manage app handoff route', () => {
  test('preserves bounty, applicant and view when normalizing an email link', () => {
    expect(
      buildManageRoutePath({ bounty: BOUNTY, applicant: APPLICANT, view: 'applicant' })
    ).toBe(`/manage/?bounty=${BOUNTY}&applicant=${APPLICANT}&view=applicant`)
  })

  test('accepts only local manage redirects and known UUID parameters', () => {
    expect(safeManageRedirect(`/manage/?bounty=${BOUNTY}&view=help`)).toBe(
      `/manage/?bounty=${BOUNTY}&view=help`
    )
    expect(safeManageRedirect('https://example.com/manage')).toBeNull()
    expect(safeManageRedirect('/manage?bounty=not-a-uuid')).toBeNull()
    expect(safeManageRedirect('/manage?next=https://example.com')).toBeNull()
    expect(safeManageRedirect('//example.com/manage')).toBeNull()
  })
})
