import {
  TEMPLATE_IDS,
  applicantRow,
  buildTemplateSend,
  rewardDisplay,
  templateKeyFor,
} from '../../supabase/functions/send-notification-email/templates'

const ENV = { preferencesUrl: 'https://www.bountyfinder.net/settings', postalAddress: '1 Main St, DC' }
const NO_ENV = { preferencesUrl: '', postalAddress: '' }
const WEB = 'https://www.bountyfinder.net/bounty?id=b1'

describe('templateKeyFor', () => {
  test('maps the poster-flow notifications to their templates', () => {
    expect(templateKeyFor('bounty_posted', {})).toBe('bounty_posted')
    expect(templateKeyFor('application', {})).toBe('new_applicants')
    expect(templateKeyFor('application_pending_reminder', {})).toBe('new_applicants')
    expect(templateKeyFor('review_needed', {})).toBe('work_submitted')
    expect(templateKeyFor('review_needed', { subtype: 'review_reminder', stage: 'first' })).toBe('work_submitted')
    expect(templateKeyFor('update', { subtype: 'work_in_progress' })).toBe('hired')
  })
  test('leaves everything else on the generic layout', () => {
    // The 72h notice says support is reviewing; "Review the work" would contradict it.
    expect(templateKeyFor('review_needed', { subtype: 'review_escalated' })).toBeNull()
    expect(templateKeyFor('update', {})).toBeNull()
    expect(templateKeyFor('message', {})).toBeNull()
    expect(templateKeyFor('acceptance', {})).toBeNull()
  })
})

describe('rewardDisplay', () => {
  test('formats like fn_email_bounty_posted', () => {
    expect(rewardDisplay(40, false)).toBe('$40')
    expect(rewardDisplay('12.5', false)).toBe('$12.50')
    expect(rewardDisplay(40, true)).toBe('For honor')
    expect(rewardDisplay(null, false)).toBe('')
  })
})

describe('bounty_posted', () => {
  test('keeps the deployed variables and idempotency key', () => {
    const out = buildTemplateSend(
      'bounty_posted',
      { bountyId: 'b1', bountyTitle: 'Mow <my> lawn', rewardDisplay: '$40', isInPerson: true, payAtHire: false, ctaUrl: WEB },
      {},
      ENV
    )
    expect(out).toEqual({
      id: TEMPLATE_IDS.bounty_posted,
      variables: {
        BOUNTY_TITLE: 'Mow &lt;my&gt; lawn',
        BOUNTY_REWARD: '$40',
        AUDIENCE_LINE: "We're letting people nearby know about it.",
        CTA_URL: WEB,
        PREFERENCES_URL: 'https://www.bountyfinder.net/settings',
        POSTAL_LINE: 'Bounty &middot; 1 Main St, DC',
      },
      idempotencyKey: 'bounty-posted/b1',
    })
  })
})

describe('new_applicants (e01)', () => {
  const applicants = [
    { name: 'Marcus <T>', idVerified: true, rating: 4.8, ratingCount: 12, jobsCompleted: 9 },
    { name: 'Dana', idVerified: false, rating: null, ratingCount: 0, jobsCompleted: 1 },
  ]
  test('lists applicants and counts the rest', () => {
    const out = buildTemplateSend(
      'application',
      { bountyId: 'b1', request_id: 'r9', ctaUrl: WEB },
      { bountyTitle: 'TV mount', reward: '$80', applicants, applicantCount: 5 },
      NO_ENV
    )!
    expect(out.id).toBe(TEMPLATE_IDS.new_applicants)
    expect(out.variables.HEADLINE).toBe('5 people want this job.')
    expect(out.variables.COUNT_NOTE).toBe(' (and 3 more)')
    expect(out.variables.BOUNTY_TITLE).toBe('TV mount')
    expect(out.variables.BOUNTY_REWARD).toBe('$80')
    expect(out.variables.CTA_URL).toBe(WEB)
    expect(out.variables.APPLICANT_ROWS).toContain('Marcus &lt;T&gt;')
    expect(out.variables.APPLICANT_ROWS).not.toContain('<T>')
    expect(out.variables.APPLICANT_ROWS).toContain('ID verified')
    expect(out.variables.APPLICANT_ROWS).toContain('New to Bounty')
    expect(out.idempotencyKey).toBe('new-applicants/r9/application')
    // Empty footer values are dropped so the template fallbacks apply.
    expect(out.variables).not.toHaveProperty('POSTAL_LINE')
  })
  test('a single applicant', () => {
    const out = buildTemplateSend('application', { bountyId: 'b1' }, { applicants: [applicants[1]], applicantCount: 1 }, NO_ENV)!
    expect(out.variables.HEADLINE).toBe('Someone wants this job.')
    expect(out.variables).not.toHaveProperty('COUNT_NOTE')
    expect(out.idempotencyKey).toBeNull()
  })
  test('applicantRow pluralizes and formats the rating', () => {
    expect(applicantRow(applicants[0])).toContain('&#9733; 4.8 (12) &middot; 9 jobs done')
    expect(applicantRow(applicants[1])).toContain('1 job done')
  })
})

describe('work_submitted (e03)', () => {
  test('first submission', () => {
    const out = buildTemplateSend(
      'review_needed',
      { bountyId: 'b1', submission_id: 's1', hunter_name: 'Marcus', is_revision: false, ctaUrl: WEB },
      { bountyTitle: 'TV mount', reward: '$80' },
      NO_ENV
    )!
    expect(out.id).toBe(TEMPLATE_IDS.work_submitted)
    expect(out.variables).toMatchObject({
      BOUNTY_TITLE: 'TV mount',
      HUNTER_NAME: 'Marcus',
      BOUNTY_REWARD: '$80',
      INTRO_HTML: 'Marcus finished the job and sent it over for your review.',
      CTA_URL: WEB,
    })
    expect(out.variables).not.toHaveProperty('HEADLINE')
    expect(out.idempotencyKey).toBe('work-submitted/s1/submitted')
  })
  test('a revision and the review-window reminders', () => {
    const rev = buildTemplateSend('review_needed', { submission_id: 's2', is_revision: true }, { hunterName: 'Dana' }, NO_ENV)!
    expect(rev.variables.HEADLINE).toBe('The changes are ready.')
    expect(rev.variables.INTRO_HTML).toContain('Dana made the changes')

    const first = buildTemplateSend(
      'review_needed',
      { submission_id: 's1', subtype: 'review_reminder', stage: 'first' },
      { hunterName: 'Dana' },
      NO_ENV
    )!
    expect(first.variables.HEADLINE).toBe('Dana is waiting on your review.')
    expect(first.idempotencyKey).toBe('work-submitted/s1/review_reminder/first')

    const final = buildTemplateSend('review_needed', { submission_id: 's1', subtype: 'review_reminder', stage: 'final' }, {}, NO_ENV)!
    expect(final.variables.HEADLINE).toBe('Last day to review.')
    expect(final.idempotencyKey).toBe('work-submitted/s1/review_reminder/final')
  })
  test('the payload hunter name wins over the looked-up one, and is escaped', () => {
    const out = buildTemplateSend('review_needed', { hunter_name: '<b>X</b>' }, { hunterName: 'Y' }, NO_ENV)!
    expect(out.variables.HUNTER_NAME).toBe('&lt;b&gt;X&lt;/b&gt;')
  })
})

describe('hired (e05)', () => {
  test('uses the producer button label and the verified badge', () => {
    const out = buildTemplateSend(
      'update',
      { subtype: 'work_in_progress', bountyId: 'b1', ctaUrl: WEB, ctaLabel: 'View your bounty' },
      { bountyTitle: 'TV mount', reward: '$80', hunterName: 'Marcus', hunterIdVerified: true },
      NO_ENV
    )
    expect(out).toEqual({
      id: TEMPLATE_IDS.hired,
      variables: {
        BOUNTY_TITLE: 'TV mount',
        BOUNTY_REWARD: '$80',
        HUNTER_NAME: 'Marcus',
        VERIFIED_BADGE: ' &middot; ID verified',
        CTA_URL: WEB,
        CTA_LABEL: 'View your bounty',
      },
      idempotencyKey: 'hired/b1',
    })
  })
  test('a non-https, non-app link is never used as the button', () => {
    const out = buildTemplateSend('update', { subtype: 'work_in_progress', ctaUrl: 'javascript:alert(1)' }, {}, NO_ENV)!
    expect(out.variables).not.toHaveProperty('CTA_URL')
  })
})

test('generic types build no template send', () => {
  expect(buildTemplateSend('message', { bountyId: 'b1' }, {}, ENV)).toBeNull()
})
