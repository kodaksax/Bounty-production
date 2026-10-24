import { buildManageRoutePath, manageDestinationPath, safeManageRedirect } from '../../lib/navigation/manage-route'

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

  test('routes applicant links to the poster activity list', () => {
    expect(manageDestinationPath({ bounty: BOUNTY, applicant: APPLICANT, view: 'applicant' })).toBe(
      '/tabs/bounty-app?tab=messages&initialTab=myPostings'
    )
  })

  test('routes help and completion links to their matching app surfaces', () => {
    expect(manageDestinationPath({ bounty: BOUNTY, view: 'help' })).toBe('/legal/how-it-works')
    expect(manageDestinationPath({ bounty: BOUNTY, view: 'complete' })).toBe(
      `/postings/${BOUNTY}/review-and-verify`
    )
  })

  test('falls back to the bounty dashboard or postings tab for generic links', () => {
    expect(manageDestinationPath({ bounty: BOUNTY, view: 'bounty' })).toBe(`/postings/${BOUNTY}`)
    expect(manageDestinationPath({})).toBe('/tabs/bounty-app?tab=postings')
  })
})
