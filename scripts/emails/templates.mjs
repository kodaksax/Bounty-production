// Bounty email templates (v2). Each entry is one Resend template.
//
// Contract rule: every template keeps the exact variable names of the
// template it replaces, so wiring a v2 template in is an ID swap. Fallbacks
// were tightened where the old ones produced broken sentences or empty boxes.
// Variables marked html:true are pre-rendered markup from the sender; every
// other variable is plain text that the sender must HTML-escape.

import {
  ASSETS, h1, h2, lead, p, small, strong, link, label, button, ticket, steps, tips,
  callout, statusRows, twoUp, stat, chips, forwardBox, signoff, footer, C,
} from './design-system.mjs'

const MANAGE = ASSETS.manage
const SITE = 'https://www.bountyfinder.net'

const posterFooter = (extraLine = '') =>
  footer({
    reason: `${extraLine}You're getting this because you have an active bounty on Bounty.`,
    links: [['Email settings', '{{{PREFERENCES_URL}}}'], ['Get help', ASSETS.support]],
  })

const lifecycleFooter = () =>
  footer({
    reason: "You're getting this because you have a Bounty account.",
    links: [['Unsubscribe from emails like this', '{{{UNSUBSCRIBE_URL}}}'], ['Email settings', '{{{PREFERENCES_URL}}}']],
  })

const POSTER_TXT_FOOTER = `—
Bounty · Got a task? Drop a bounty.
You're getting this because you have an active bounty on Bounty.
Email settings: {{{PREFERENCES_URL}}}
Get help: support@bountyfinder.app
{{{POSTAL_LINE}}}`

const LIFECYCLE_TXT_FOOTER = `—
Bounty · Got a task? Drop a bounty.
You're getting this because you have a Bounty account.
Unsubscribe from emails like this: {{{UNSUBSCRIBE_URL}}}
Email settings: {{{PREFERENCES_URL}}}
{{{POSTAL_LINE}}}`

// Sample applicant rows: the markup a sender should produce for APPLICANT_ROWS
// (escape name/pitch; initial-letter avatar means no profile photo is needed).
export function applicantRow({ initial, name, verified, jobs, pitch }) {
  const badge = verified
    ? `&nbsp;<span class="c-tint-g c-tint-g-t" style="display:inline-block;padding:2px 8px;border-radius:999px;background-color:${C.greenTint};font-family:Arial,sans-serif;font-size:11px;line-height:16px;font-weight:700;color:#0B6A31;vertical-align:1px;">ID verified</span>`
    : ''
  return `<tr><td class="c-line" style="padding:14px 0;border-bottom:1px solid ${C.line};"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
<td width="48" valign="top"><span class="c-tint-g c-tint-g-t" style="display:inline-block;width:36px;height:36px;border-radius:18px;background-color:${C.greenTint};text-align:center;font-family:Arial,sans-serif;font-size:15px;line-height:36px;font-weight:800;color:#0B6A31;">${initial}</span></td>
<td valign="top"><p class="c-ink" style="margin:0;font-family:Arial,sans-serif;font-size:16px;line-height:22px;font-weight:700;color:${C.ink};">${name}${badge}</p>
<p class="c-muted" style="margin:2px 0 0;font-family:Arial,sans-serif;font-size:13px;line-height:19px;color:${C.muted};">${jobs}</p>
${pitch ? `<p class="c-body" style="margin:6px 0 0;font-family:Arial,sans-serif;font-size:15px;line-height:22px;color:${C.body};">&ldquo;${pitch}&rdquo;</p>` : ''}</td>
</tr></table></td></tr>`
}

const LONG_TITLE = 'Help me move a 3-seat sectional &amp; two &quot;IKEA-proof&quot; bookcases up 4 flights (no elevator) &lt;urgent&gt; — Columbia Heights → Silver Spring'

export const TEMPLATES = [
  // ------------------------------------------------------------------ e10
  {
    key: 'e10-bounty-live',
    alias: 'bounty-v2-posted',
    name: 'Bounty v2 · Bounty posted',
    replaces: ['386c9e82-f564-40e0-ae4c-83dac4db318d', 'c1e64756-edb3-43e8-b8d2-35fa363935a3'],
    trigger: 'notification type bounty_posted (send-notification-email RESEND_TEMPLATE_BY_TYPE)',
    audience: 'poster',
    kind: 'transactional',
    status: 'wired today (current template); v2 is a drop-in ID swap',
    subject: "You're live. People can apply now.",
    preheader: "We'll email you as people apply. You choose who does it.",
    stamp: { label: 'Live', tone: 'success' },
    vars: {
      BOUNTY_TITLE: 'Your bounty',
      BOUNTY_REWARD: '—',
      AUDIENCE_LINE: "We're letting people who do this kind of work know about it.",
      PAY_LINE: '',
      HELP_LINE: 'Manage it on bountyfinder.net or in the Bounty app.',
      FOOTER_LINE: '',
      CTA_URL: MANAGE,
      PREFERENCES_URL: SITE,
      POSTAL_LINE: '',
    },
    body: () =>
      h1("You're live.") +
      lead('{{{AUDIENCE_LINE}}}') +
      ticket({ kicker: 'Live now' }) +
      steps(
        [
          ['People apply.', "We'll email you as they come in."],
          ['Size them up.', 'Jobs done, ID verification and their pitch. Ask questions before you decide.'],
          ['Choose one.', '{{{PAY_LINE}}}Bounty holds the money until you approve the finished work.'],
        ],
        'What happens next'
      ) +
      button('View your bounty', '{{{CTA_URL}}}') +
      small('{{{HELP_LINE}}}', 18),
    footer: () => posterFooter('{{{FOOTER_LINE}}} '),
    text: `You're live.

{{{AUDIENCE_LINE}}}

LIVE NOW
{{{BOUNTY_TITLE}}} · {{{BOUNTY_REWARD}}}

What happens next
01 People apply. We'll email you as they come in.
02 Size them up. Jobs done, ID verification and their pitch. Ask questions before you decide.
03 Choose one. {{{PAY_LINE}}}Bounty holds the money until you approve the finished work.

View your bounty: {{{CTA_URL}}}

{{{HELP_LINE}}}
{{{FOOTER_LINE}}}

${POSTER_TXT_FOOTER}`,
    samples: {
      realistic: { BOUNTY_TITLE: 'Assemble an IKEA dresser', BOUNTY_REWARD: '$45', AUDIENCE_LINE: "We're letting people nearby know about it.", PAY_LINE: "That's when you pay. ", HELP_LINE: 'Use the button above to manage your bounty on the web.', CTA_URL: MANAGE + '?bounty=00000000-0000-4000-8000-000000000000', POSTAL_LINE: 'Bounty Inc. &middot; Postal address on file' },
      edge: { BOUNTY_TITLE: LONG_TITLE, BOUNTY_REWARD: '$10,000.00' },
    },
  },

  // ------------------------------------------------------------------ e01
  {
    key: 'e01-new-applicants',
    alias: 'bounty-v2-new-applicants',
    name: 'Bounty v2 · New applicants',
    replaces: ['8ea157bb-a4ed-4838-ad30-18d147211add', '97d63c1e-15fa-4cb6-b909-a77a8e1e9da3'],
    trigger: "type 'application' (poster). Today sent by the generic layout via the email fallback; this template needs APPLICANT_ROWS from the sender.",
    audience: 'poster',
    kind: 'transactional',
    status: 'not wired (no sender computes APPLICANT_ROWS yet)',
    subject: "You've got applicants",
    preheader: "Pick one and it's handled.{{{PREHEADER_PAY_NOTE}}}",
    stamp: { label: 'Your move', tone: 'action' },
    vars: {
      HEADLINE: 'People want this job.',
      PREHEADER_PAY_NOTE: '',
      BOUNTY_TITLE: 'Your bounty',
      BOUNTY_REWARD: '—',
      COUNT_NOTE: '',
      APPLICANT_ROWS: { html: true, fallback: `<tr><td style="padding:14px 0;border-bottom:1px solid ${C.line};font-family:Arial,sans-serif;font-size:15px;line-height:22px;color:${C.body};">See everyone who applied on your bounty page.</td></tr>` },
      MONEY_NOTE: 'Bounty holds the money until you approve the finished work.',
      CTA_URL: MANAGE,
      PREFERENCES_URL: SITE,
      POSTAL_LINE: '',
    },
    body: () =>
      h1('{{{HEADLINE}}}') +
      ticket() +
      label("Who's in line{{{COUNT_NOTE}}}") +
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="c-line" style="margin:0 0 18px;border-top:1px solid ${C.line};">{{{APPLICANT_ROWS}}}</table>` +
      p('Open the list for full profiles, or ask anyone a question before you decide.', 20) +
      callout('{{{MONEY_NOTE}}}') +
      button('Choose your hunter', '{{{CTA_URL}}}') +
      small('Unanswered applications close automatically.', 18),
    footer: () => posterFooter(),
    text: `{{{HEADLINE}}}

YOUR BOUNTY
{{{BOUNTY_TITLE}}} · {{{BOUNTY_REWARD}}}

People have applied{{{COUNT_NOTE}}}. Open the list for full profiles, or ask anyone a question before you decide.

{{{MONEY_NOTE}}}

Choose your hunter: {{{CTA_URL}}}

Unanswered applications close automatically.

${POSTER_TXT_FOOTER}`,
    samples: {
      realistic: {
        HEADLINE: '3 people want this job.', BOUNTY_TITLE: 'Deliver groceries from Safeway', BOUNTY_REWARD: '$25', COUNT_NOTE: ' (3)',
        APPLICANT_ROWS: [
          applicantRow({ initial: 'J', name: 'Jordan M.', verified: true, jobs: '12 jobs done', pitch: "I'm 5 minutes away and have a car. Can do it this afternoon." }),
          applicantRow({ initial: 'D', name: 'Deon W.', verified: true, jobs: '3 jobs done', pitch: 'Free after 4pm, happy to grab anything else on the way.' }),
          applicantRow({ initial: 'S', name: 'Stacie L.', verified: false, jobs: 'New to Bounty', pitch: '' }),
        ].join(''),
        CTA_URL: MANAGE + '?view=applicant',
      },
      edge: { BOUNTY_TITLE: LONG_TITLE, BOUNTY_REWARD: '$10,000.00' },
    },
  },

  // ------------------------------------------------------------------ e02
  {
    key: 'e02-applicants-closing',
    alias: 'bounty-v2-closing-soon',
    name: 'Bounty v2 · Applications closing soon',
    replaces: ['7f48ae5b-5a7f-42c0-aade-3399f0853245', '99ffa33e-c98c-4ecc-a3ad-0ac1704834a0'],
    trigger: 'Pending applications approaching request expiry (72h / 168h if interacted, posting_policy_config). No producer emits this yet.',
    audience: 'poster',
    kind: 'transactional',
    status: 'not wired',
    subject: 'Your applicants close soon',
    preheader: '{{{APPLICANT_LABEL}}} waiting. After {{{CLOSES_AT_LABEL}}}, they move on.',
    stamp: { label: 'Closing soon', tone: 'action' },
    vars: {
      APPLICANT_LABEL: 'Applicants',
      CLOSES_AT_LABEL: 'the deadline',
      BOUNTY_TITLE: 'Your bounty',
      BOUNTY_REWARD: '—',
      CTA_URL: MANAGE,
      PREFERENCES_URL: SITE,
      POSTAL_LINE: '',
    },
    body: () =>
      h1("Don't let this one slip.") +
      stat('{{{APPLICANT_LABEL}}}', 'waiting on your answer', 'Decide by', '{{{CLOSES_AT_LABEL}}}') +
      ticket() +
      p("If nobody's chosen by then, their applications close automatically and they move on to other work.") +
      p("Not feeling any of them? Decline from the same screen. It frees them up, and your bounty stays open for new people.", 20) +
      button('Review applicants', '{{{CTA_URL}}}'),
    footer: () => posterFooter(),
    text: `Don't let this one slip.

{{{APPLICANT_LABEL}}} waiting on your answer. Decide by {{{CLOSES_AT_LABEL}}}.

YOUR BOUNTY
{{{BOUNTY_TITLE}}} · {{{BOUNTY_REWARD}}}

If nobody's chosen by then, their applications close automatically and they move on to other work.

Not feeling any of them? Decline from the same screen. It frees them up, and your bounty stays open for new people.

Review applicants: {{{CTA_URL}}}

${POSTER_TXT_FOOTER}`,
    samples: {
      realistic: { APPLICANT_LABEL: '3 applicants', CLOSES_AT_LABEL: 'Fri, 5:00 PM', BOUNTY_TITLE: 'Deliver me food', BOUNTY_REWARD: '$20' },
      edge: { BOUNTY_TITLE: LONG_TITLE, BOUNTY_REWARD: '$10,000.00' },
    },
  },

  // ------------------------------------------------------------------ e03
  {
    key: 'e03-work-submitted',
    alias: 'bounty-v2-ready-for-review',
    name: 'Bounty v2 · Work ready for review',
    replaces: ['a33f5f57-b748-4689-90ef-11dc5eb6f325', '1ff688b6-2302-4b14-9b3f-3ff273d5a759'],
    trigger: "type 'completion' (completion submitted; handle_completion_submission_notification)",
    audience: 'poster',
    kind: 'transactional',
    status: 'not wired (completion emails use the generic layout)',
    subject: 'Marked done. Your turn to review.',
    preheader: '{{{PREHEADER}}}',
    stamp: { label: 'Ready to review', tone: 'success' },
    vars: {
      PREHEADER: 'Check the work, then release payment.',
      HEADLINE: 'Your task is marked done.',
      BOUNTY_TITLE: 'Your bounty',
      HUNTER_NAME: 'your hunter',
      BOUNTY_REWARD: '—',
      INTRO_HTML: { html: true, fallback: 'Your hunter finished the job and sent it over for your review.' },
      CTA_URL: MANAGE,
      PREFERENCES_URL: SITE,
      POSTAL_LINE: '',
    },
    body: () =>
      h1('{{{HEADLINE}}}') +
      ticket({ meta: 'Done by {{{HUNTER_NAME}}}' }) +
      p('{{{INTRO_HTML}}}', 20) +
      twoUp(
        ['Looks right?', 'Approve it and we release your payment to {{{HUNTER_NAME}}}.'],
        ["Something's off?", 'Request changes. The money stays held until you approve.']
      ) +
      button('Review the work', '{{{CTA_URL}}}'),
    footer: () => posterFooter(),
    text: `{{{HEADLINE}}}

YOUR BOUNTY
{{{BOUNTY_TITLE}}} · {{{BOUNTY_REWARD}}}
Done by {{{HUNTER_NAME}}}

Looks right? Approve it and we release your payment to {{{HUNTER_NAME}}}.
Something's off? Request changes. The money stays held until you approve.

Review the work: {{{CTA_URL}}}

${POSTER_TXT_FOOTER}`,
    samples: {
      realistic: { HEADLINE: 'Jordan marked it done.', BOUNTY_TITLE: 'Assemble an IKEA dresser', HUNTER_NAME: 'Jordan', BOUNTY_REWARD: '$45', INTRO_HTML: 'Jordan finished the job and added 2 photos for you to check.' },
      edge: { BOUNTY_TITLE: LONG_TITLE, BOUNTY_REWARD: '$10,000.00' },
    },
  },

  // ------------------------------------------------------------------ e05
  {
    key: 'e05-hired-next-steps',
    alias: 'bounty-v2-hired',
    name: 'Bounty v2 · Hired, next steps',
    replaces: ['31e736fe-190e-43a0-904e-f66c8a8055a7', 'cce76f31-c6a6-49d9-ac26-9895daed5ddf'],
    trigger: "Poster confirms a hire (type 'acceptance' recipient side is the hunter; this is the poster's confirmation)",
    audience: 'poster',
    kind: 'transactional',
    status: 'not wired',
    subject: "It's a deal. Here's what happens next.",
    preheader: 'Your {{{BOUNTY_REWARD}}} is held by Bounty until you approve the work.',
    stamp: { label: 'Hired', tone: 'success' },
    vars: {
      BOUNTY_TITLE: 'Your bounty',
      BOUNTY_REWARD: 'payment',
      HUNTER_NAME: 'your hunter',
      VERIFIED_BADGE: { html: true, fallback: '' },
      ADDRESS_NOTE: '',
      CTA_URL: MANAGE,
      CTA_LABEL: 'View your bounty',
      PREFERENCES_URL: SITE,
      POSTAL_LINE: '',
    },
    body: () =>
      h1("Done deal. Here's what happens now.") +
      ticket({ kicker: 'Hired', meta: 'With {{{HUNTER_NAME}}}{{{VERIFIED_BADGE}}}' }) +
      steps([
        ['Say hi and confirm the details.', 'Time, place, anything they should know.{{{ADDRESS_NOTE}}}'],
        ['They do the work.', 'When it’s finished, {{{HUNTER_NAME}}} marks it done in Bounty.'],
        ['You check it and approve.', "That's when your {{{BOUNTY_REWARD}}} is released. Not before."],
      ]) +
      callout('Keep chat and payment in Bounty. Your money stays held until you approve, and if something goes wrong, we can only step in on what happened here.', 'Stay in Bounty') +
      button('{{{CTA_LABEL}}}', '{{{CTA_URL}}}'),
    footer: () => posterFooter(),
    text: `Done deal. Here's what happens now.

HIRED
{{{BOUNTY_TITLE}}} · {{{BOUNTY_REWARD}}}
With {{{HUNTER_NAME}}}

01 Say hi and confirm the details. Time, place, anything they should know.{{{ADDRESS_NOTE}}}
02 They do the work. When it's finished, {{{HUNTER_NAME}}} marks it done in Bounty.
03 You check it and approve. That's when your {{{BOUNTY_REWARD}}} is released. Not before.

Keep chat and payment in Bounty. Your money stays held until you approve, and if something goes wrong, we can only step in on what happened here.

{{{CTA_LABEL}}}: {{{CTA_URL}}}

${POSTER_TXT_FOOTER}`,
    samples: {
      realistic: { BOUNTY_TITLE: 'Assemble an IKEA dresser', BOUNTY_REWARD: '$45', HUNTER_NAME: 'Jordan', VERIFIED_BADGE: ` &middot; <span style="color:#0B6A31;font-weight:700;">ID verified</span>` },
      edge: { BOUNTY_TITLE: LONG_TITLE },
    },
  },

  // ------------------------------------------------------------------ e06
  {
    key: 'e06-payment-failed-at-hire',
    alias: 'bounty-v2-payment-failed',
    name: 'Bounty v2 · Payment failed at hire',
    replaces: ['4d930f7e-0863-43d6-8678-f466b374cf0c', 'f1fb0958-4c85-418e-a37a-cdc9b13fa8ee'],
    trigger: 'Pay-at-hire card payment fails when a poster picks a hunter (web poster flow)',
    audience: 'poster',
    kind: 'transactional',
    status: 'not wired',
    subject: "Your payment didn't go through",
    preheader: "You weren't charged, and {{{HUNTER_NAME}}} isn't hired yet.",
    stamp: { label: 'Action needed', tone: 'action' },
    vars: {
      HUNTER_NAME: 'your hunter',
      BOUNTY_TITLE: 'Your bounty',
      BOUNTY_REWARD: '—',
      CLOSES_AT_NOTE: '',
      CTA_URL: MANAGE,
      PREFERENCES_URL: SITE,
      POSTAL_LINE: '',
    },
    body: () =>
      h1('One step left to hire {{{HUNTER_NAME}}}.') +
      p("You picked them, but the payment didn't go through. Here's exactly where things stand:", 14) +
      statusRows([
        ['Payment', "Didn't go through", 'alert'],
        ['Charged', 'Nothing'],
        ['Hired', 'Not yet'],
        ['Their application', 'Still open{{{CLOSES_AT_NOTE}}}', 'success'],
      ]) +
      ticket() +
      p("Try a different card and you're set.", 20) +
      button('Try another payment method', '{{{CTA_URL}}}') +
      small('Keeps failing? Reply to this email and a person on our team will help.', 18),
    footer: () => posterFooter(),
    text: `One step left to hire {{{HUNTER_NAME}}}.

You picked them, but the payment didn't go through.

Payment: didn't go through
Charged: nothing
Hired: not yet
Their application: still open{{{CLOSES_AT_NOTE}}}

YOUR BOUNTY
{{{BOUNTY_TITLE}}} · {{{BOUNTY_REWARD}}}

Try a different card and you're set: {{{CTA_URL}}}

Keeps failing? Reply to this email and a person on our team will help.

${POSTER_TXT_FOOTER}`,
    samples: {
      realistic: { HUNTER_NAME: 'Jordan', BOUNTY_TITLE: 'Move a couch', BOUNTY_REWARD: '$60', CLOSES_AT_NOTE: ' until Fri, 5:00 PM' },
      edge: { BOUNTY_TITLE: LONG_TITLE, BOUNTY_REWARD: '$10,000.00' },
    },
  },

  // ------------------------------------------------------------------ e07
  {
    key: 'e07-no-applicants-24h',
    alias: 'bounty-v2-no-applicants',
    name: 'Bounty v2 · No applicants yet',
    replaces: ['9e4b6d2a-7ef8-4b44-9118-98a7339d87df', '0f587928-3b27-4805-acf7-5c401eda6e4e'],
    trigger: 'Bounty open ~24h with zero applications (overlaps today’s bounty_quality_nudge / liquidity escalation push copy)',
    audience: 'poster',
    kind: 'transactional',
    status: 'not wired',
    subject: 'No applicants yet. One change usually fixes it.',
    preheader: "Here's where to start. It takes a minute.",
    stamp: { label: 'Needs a nudge', tone: 'neutral' },
    vars: {
      BOUNTY_TITLE: 'Your bounty',
      BOUNTY_REWARD: 'the current price',
      WIDENED_NOTE: '',
      CTA_URL: MANAGE,
      PREFERENCES_URL: SITE,
      POSTAL_LINE: '',
    },
    body: () =>
      h1("Let's get this one moving.") +
      ticket() +
      p("It's been up for a day without an applicant.{{{WIDENED_NOTE}}} When a post sits, it's usually one of these:", 14) +
      tips([
        ['The price.', 'At {{{BOUNTY_REWARD}}}, it may read as low for the effort. Raising it is the quickest fix.'],
        ['The details.', "What, where, and roughly how long. People skip jobs they can't size up."],
        ['A photo,', "if there's something to see."],
      ]) +
      button('Edit your bounty', '{{{CTA_URL}}}'),
    footer: () => posterFooter(),
    text: `Let's get this one moving.

YOUR BOUNTY
{{{BOUNTY_TITLE}}} · {{{BOUNTY_REWARD}}}

It's been up for a day without an applicant.{{{WIDENED_NOTE}}} When a post sits, it's usually one of these:
→ The price. At {{{BOUNTY_REWARD}}}, it may read as low for the effort. Raising it is the quickest fix.
→ The details. What, where, and roughly how long. People skip jobs they can't size up.
→ A photo, if there's something to see.

Edit your bounty: {{{CTA_URL}}}

${POSTER_TXT_FOOTER}`,
    samples: {
      realistic: { BOUNTY_TITLE: 'Yard cleanup (front + back)', BOUNTY_REWARD: '$30', WIDENED_NOTE: " We've already widened who sees it." },
      edge: { BOUNTY_TITLE: LONG_TITLE },
    },
  },

  // ----------------------------------------------------------------- e08a
  {
    key: 'e08a-poster-intent-no-post',
    alias: 'bounty-v2-getting-started',
    name: 'Bounty v2 · Getting started',
    replaces: ['4568e110-cbae-4f8e-8fa5-9605d59d38e9', '5ed7bb92-7862-4f98-aa88-02a85f567d79'],
    trigger: 'Signed up with poster intent, has not posted (lifecycle)',
    audience: 'poster',
    kind: 'lifecycle',
    status: 'not wired',
    subject: 'Got a task? Drop a bounty.',
    preheader: 'Post it in a minute. People nearby apply to do it.',
    stamp: { label: 'Getting started', tone: 'success' },
    vars: {
      OPENER: 'You',
      PAY_LINE: '',
      CTA_URL: MANAGE,
      UNSUBSCRIBE_URL: SITE,
      PREFERENCES_URL: SITE,
      POSTAL_LINE: '',
    },
    body: () =>
      h1('Name the thing you keep putting off.') +
      lead("{{{OPENER}}} joined Bounty to get something done. Here's the whole thing:") +
      steps([
        ["Say what you need and what you'll pay.", 'Anything from $5 up.'],
        ['People nearby apply.', "You see how many jobs they've done and whether they're ID-verified."],
        ['Pick one.', '{{{PAY_LINE}}}Bounty holds the money until you approve the work.'],
      ]) +
      chips(['Moving a couch', 'Assembling furniture', 'Yard cleanup', 'A pickup across town', 'Waiting in line'], 'Small jobs are fair game') +
      button('Post a task', '{{{CTA_URL}}}'),
    footer: () => lifecycleFooter(),
    text: `Name the thing you keep putting off.

{{{OPENER}}} joined Bounty to get something done. Here's the whole thing:

01 Say what you need and what you'll pay. Anything from $5 up.
02 People nearby apply. You see how many jobs they've done and whether they're ID-verified.
03 Pick one. {{{PAY_LINE}}}Bounty holds the money until you approve the work.

Small jobs are fair game: moving a couch, assembling furniture, yard cleanup, a pickup across town, waiting in line.

Post a task: {{{CTA_URL}}}

${LIFECYCLE_TXT_FOOTER}`,
    samples: { realistic: { OPENER: 'Grace, you', PAY_LINE: "You pay when you hire. " }, edge: {} },
  },

  // ----------------------------------------------------------------- e08b
  {
    key: 'e08b-concierge-reply',
    alias: 'bounty-v2-concierge',
    name: 'Bounty v2 · Concierge: tell us the task',
    replaces: ['e0870e43-97a2-4561-b04e-612cb211b0f4', 'b947ed52-f8c9-4023-bd70-8bde554cbdda'],
    trigger: 'Poster intent, still no post after Getting started (lifecycle). Replies go to support@.',
    audience: 'poster',
    kind: 'lifecycle',
    status: 'not wired',
    replyTo: 'support@bountyfinder.app',
    subject: 'Not sure how to post it? Tell us.',
    preheader: "Tell us the job. We'll tell you how to post it and what to offer.",
    stamp: { label: 'A person, not a bot', tone: 'neutral' },
    vars: {
      REPLY_MAILTO: 'mailto:support@bountyfinder.app?subject=Help%20me%20post%20a%20task',
      UNSUBSCRIBE_URL: SITE,
      PREFERENCES_URL: SITE,
      POSTAL_LINE: '',
    },
    body: () =>
      h1('Tell us what you need done.') +
      p("Some jobs are easy to post. Others leave you wondering what to write, or what's a fair price.") +
      p('Reply with the task in your own words. Someone on the Bounty team will write back with a title, a description and a price you can post as-is.', 20) +
      button('Reply with your task', '{{{REPLY_MAILTO}}}') +
      small('Or just hit reply. It goes to the same place.', 18) +
      signoff(),
    footer: () => lifecycleFooter(),
    text: `Tell us what you need done.

Some jobs are easy to post. Others leave you wondering what to write, or what's a fair price.

Reply with the task in your own words. Someone on the Bounty team will write back with a title, a description and a price you can post as-is.

Just hit reply. It goes straight to us.

— The Bounty team

${LIFECYCLE_TXT_FOOTER}`,
    samples: { realistic: {}, edge: {} },
  },

  // ------------------------------------------------------------------ e09
  {
    key: 'e09-first-done-next',
    alias: 'bounty-v2-first-done',
    name: 'Bounty v2 · First bounty done',
    replaces: ['25bce0fb-0059-4184-aeae-f8f9ecf94e2f', 'e9526aac-81e4-4676-9196-f242c892ba03'],
    trigger: 'Poster approved their first completed bounty (lifecycle follow-up after release)',
    audience: 'poster',
    kind: 'lifecycle',
    status: 'not wired',
    subject: "It's off the list.",
    preheader: '“{{{BOUNTY_TITLE}}}” is done. The next one works the same way.',
    stamp: { label: 'Done', tone: 'success' },
    vars: {
      BOUNTY_TITLE: 'your bounty',
      HUNTER_NAME: 'your hunter',
      CTA_URL: MANAGE,
      UNSUBSCRIBE_URL: SITE,
      PREFERENCES_URL: SITE,
      POSTAL_LINE: '',
    },
    body: () =>
      h1('One thing off the list.') +
      ticket({ kicker: 'First one down', done: true }) +
      p(`It's finished, and your payment was released to {{{HUNTER_NAME}}}. You posted it, picked someone and approved the work. ${strong("That's the whole loop.")}`) +
      p('Most lists have more than one thing on them. The next post takes a minute, and now you know exactly how it goes.', 20) +
      button('Post the next one', '{{{CTA_URL}}}'),
    footer: () => lifecycleFooter(),
    text: `One thing off the list.

DONE: {{{BOUNTY_TITLE}}}

It's finished, and your payment was released to {{{HUNTER_NAME}}}. You posted it, picked someone and approved the work. That's the whole loop.

Most lists have more than one thing on them. The next post takes a minute, and now you know exactly how it goes.

Post the next one: {{{CTA_URL}}}

${LIFECYCLE_TXT_FOOTER}`,
    samples: { realistic: { BOUNTY_TITLE: 'Assemble an IKEA dresser', HUNTER_NAME: 'Jordan' }, edge: { BOUNTY_TITLE: LONG_TITLE } },
  },

  // ------------------------------------------------------------------ e11
  {
    key: 'e11-dormant-poster',
    alias: 'bounty-v2-dormant-poster',
    name: 'Bounty v2 · Got another one?',
    replaces: ['d62fcefe-fa57-478f-ae23-83f507340f6f', 'ba9eee99-7b47-4f37-8427-c48d845e9d66'],
    trigger: 'Poster with a past bounty, inactive for a while (lifecycle)',
    audience: 'poster',
    kind: 'lifecycle',
    status: 'not wired',
    subject: 'Got another one?',
    preheader: 'Last time: “{{{LAST_BOUNTY_TITLE}}}.” What’s next?',
    stamp: { label: 'Been a minute', tone: 'neutral' },
    vars: {
      LAST_BOUNTY_TITLE: 'a task',
      COMPLETED_NOTE: '',
      SEASONAL_LINE: '',
      CTA_URL: MANAGE,
      UNSUBSCRIBE_URL: SITE,
      PREFERENCES_URL: SITE,
      POSTAL_LINE: '',
    },
    body: () =>
      h1('Got another one?') +
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 20px;"><tr><td class="c-line" style="padding:2px 0 2px 16px;border-left:3px solid ${C.green};">${label('Last time you posted')}<p class="c-ink" style="margin:0;font-family:Arial,sans-serif;font-size:18px;line-height:25px;font-weight:700;color:${C.ink};word-break:break-word;">{{{LAST_BOUNTY_TITLE}}}</p><p class="c-muted" style="margin:2px 0 0;font-family:Arial,sans-serif;font-size:14px;line-height:20px;color:${C.muted};">{{{COMPLETED_NOTE}}}</p></td></tr></table>` +
      p('{{{SEASONAL_LINE}}}') +
      p('Same as before: say what, set the price, pick someone nearby.', 20) +
      button('Post a task', '{{{CTA_URL}}}'),
    footer: () => lifecycleFooter(),
    text: `Got another one?

Last time you posted: {{{LAST_BOUNTY_TITLE}}} {{{COMPLETED_NOTE}}}

{{{SEASONAL_LINE}}}

Same as before: say what, set the price, pick someone nearby.

Post a task: {{{CTA_URL}}}

${LIFECYCLE_TXT_FOOTER}`,
    samples: { realistic: { LAST_BOUNTY_TITLE: 'Rake the front yard', COMPLETED_NOTE: 'Done by Deon in 2 days', SEASONAL_LINE: 'Gutters, leaves, the storm windows. Fall has a list.' }, edge: { LAST_BOUNTY_TITLE: LONG_TITLE } },
  },

  // ------------------------------------------------------------------ e12
  {
    key: 'e12-web-checkout-abandoned',
    alias: 'bounty-v2-checkout-abandoned',
    name: 'Bounty v2 · Checkout not finished',
    replaces: ['d7fe3e5b-3d66-430c-83eb-c6e015cf150c', '328fb44e-a4dd-47c1-ad5b-15641adf2873'],
    trigger: 'Web poster started checkout (poster-web) but did not complete payment',
    audience: 'poster',
    kind: 'lifecycle',
    status: 'not wired',
    subject: "You're one step from posted",
    preheader: "Checkout wasn't finished, so you weren't charged. Pick up where you left off.",
    stamp: { label: 'Not posted yet', tone: 'action' },
    vars: {
      BOUNTY_TITLE: 'Your bounty',
      BOUNTY_REWARD: '—',
      OPENER: 'You',
      CTA_URL: MANAGE,
      UNSUBSCRIBE_URL: SITE,
      POSTAL_LINE: '',
    },
    body: () =>
      h1("You're one step from posted.") +
      p("{{{OPENER}}} got as far as payment, but checkout wasn't finished.", 14) +
      statusRows([['Live', 'Not yet', 'action'], ['Charged', 'Nothing']]) +
      ticket() +
      p('Finish checkout and it goes up right away. Bounty holds the payment until you approve the finished work.', 20) +
      button('Finish posting', '{{{CTA_URL}}}'),
    footer: () =>
      footer({
        reason: "You're getting this because you started a bounty at Bounty with this address.",
        links: [["Don't email me about this", '{{{UNSUBSCRIBE_URL}}}'], ['Get help', ASSETS.support]],
      }),
    text: `You're one step from posted.

{{{OPENER}}} got as far as payment, but checkout wasn't finished.
Live: not yet
Charged: nothing

YOUR BOUNTY
{{{BOUNTY_TITLE}}} · {{{BOUNTY_REWARD}}}

Finish checkout and it goes up right away. Bounty holds the payment until you approve the finished work.

Finish posting: {{{CTA_URL}}}

—
Bounty · Got a task? Drop a bounty.
You're getting this because you started a bounty at Bounty with this address.
Don't email me about this: {{{UNSUBSCRIBE_URL}}}
{{{POSTAL_LINE}}}`,
    samples: { realistic: { BOUNTY_TITLE: 'Pick up a package from the post office', BOUNTY_REWARD: '$15', OPENER: 'Giselle, you' }, edge: { BOUNTY_TITLE: LONG_TITLE, BOUNTY_REWARD: '$10,000.00' } },
  },

  // ------------------------------------------------------------------ e13
  {
    key: 'e13-hunter-cancelled',
    alias: 'bounty-v2-hunter-cancelled',
    name: 'Bounty v2 · Hunter cancelled',
    replaces: ['6c339d8d-81cc-4469-af1f-cee1b996e8b0', '8d04710d-549e-42ae-9d6c-1fb3d552d9f2'],
    trigger: 'Hired hunter cancels (cancellation_* types). MONEY_LINE must come from the real cancellation/refund state.',
    audience: 'poster',
    kind: 'transactional',
    status: 'not wired',
    subject: 'Change of plans on your bounty',
    preheader: '{{{MONEY_LINE}}}',
    stamp: { label: 'Change of plans', tone: 'neutral' },
    vars: {
      MONEY_LINE: 'Check your bounty page for where your payment stands.',
      BOUNTY_TITLE: 'Your bounty',
      BOUNTY_REWARD: '—',
      HUNTER_NAME: 'Your hunter',
      REOPEN_LINE: 'You can reopen it or post it again from your bounty page.',
      CTA_URL: MANAGE,
      PREFERENCES_URL: SITE,
      POSTAL_LINE: '',
    },
    body: () =>
      h1("{{{HUNTER_NAME}}} can't do this one.") +
      ticket() +
      callout('{{{MONEY_LINE}}}', 'Your money', 'neutral') +
      p('{{{REOPEN_LINE}}}', 20) +
      button('Find someone else', '{{{CTA_URL}}}'),
    footer: () => posterFooter(),
    text: `{{{HUNTER_NAME}}} can't do this one.

YOUR BOUNTY
{{{BOUNTY_TITLE}}} · {{{BOUNTY_REWARD}}}

Your money: {{{MONEY_LINE}}}

{{{REOPEN_LINE}}}

Find someone else: {{{CTA_URL}}}

${POSTER_TXT_FOOTER}`,
    samples: { realistic: { HUNTER_NAME: 'Jordan', BOUNTY_TITLE: 'Move a couch', BOUNTY_REWARD: '$60', MONEY_LINE: '[Sample] Your payment status for this bounty goes here, from the real cancellation record.' }, edge: { BOUNTY_TITLE: LONG_TITLE } },
  },

  // ------------------------------------------------------------------ e14
  {
    key: 'e14-forward-to-a-friend',
    alias: 'bounty-v2-pass-it-on',
    name: 'Bounty v2 · Pass it on',
    replaces: ['69c36213-d9b6-47ff-9a57-7becaba0613c', 'f18086c0-3f76-4058-94a7-bf4c2219231e'],
    trigger: 'After a completed bounty (lifecycle, forward-to-a-friend)',
    audience: 'poster',
    kind: 'lifecycle',
    status: 'not wired',
    subject: 'You got it done. Know someone who hasn’t?',
    preheader: 'Forward this. It has everything they need.',
    stamp: { label: 'Pass it on', tone: 'success' },
    vars: {
      BOUNTY_TITLE: 'your bounty',
      CTA_URL: SITE,
      UNSUBSCRIBE_URL: SITE,
      PREFERENCES_URL: SITE,
      POSTAL_LINE: '',
    },
    body: () =>
      h1('You got it done. Know someone who hasn’t?') +
      p(`You got ${strong('{{{BOUNTY_TITLE}}}')} handled through Bounty. Somebody you know is putting off something just like it.`) +
      p(`${strong('Forward this email to them.')} Everything in the box is for them. There's no referral bonus. It's just a good thing to pass on.`, 20) +
      forwardBox(
        label('For whoever this was forwarded to') +
          h2('Got a task? Drop a bounty.') +
          p('Bounty is how people get small jobs done by someone nearby. Post the task and your price, choose from the people who apply, and the money is released only after you approve the work.') +
          button('Get Bounty', '{{{CTA_URL}}}')
      ),
    footer: () => lifecycleFooter(),
    text: `You got it done. Know someone who hasn't?

You got {{{BOUNTY_TITLE}}} handled through Bounty. Somebody you know is putting off something just like it.

Forward this email to them. Everything below is for them. There's no referral bonus. It's just a good thing to pass on.

— For whoever this was forwarded to —
Got a task? Drop a bounty.
Bounty is how people get small jobs done by someone nearby. Post the task and your price, choose from the people who apply, and the money is released only after you approve the work.
Get Bounty: {{{CTA_URL}}}

${LIFECYCLE_TXT_FOOTER}`,
    samples: { realistic: { BOUNTY_TITLE: 'Assemble an IKEA dresser' }, edge: { BOUNTY_TITLE: LONG_TITLE } },
  },

  // ------------------------------------------------------------- unfinished
  {
    key: 'unfinished-post',
    alias: 'bounty-v2-unfinished-post',
    name: 'Bounty v2 · Unfinished post',
    replaces: ['8e73f6a2-f80c-400b-9eed-c6d8b606c985', 'fd67f605-c21c-4d76-8b2a-5f68f3654838'],
    trigger: 'Started a post, did not publish (lifecycle)',
    audience: 'poster',
    kind: 'lifecycle',
    status: 'not wired',
    subject: 'Still need that done?',
    preheader: 'Your post is a minute from live.{{{PREHEADER_PAY_NOTE}}}',
    stamp: { label: 'Unfinished post', tone: 'neutral' },
    vars: {
      PREHEADER_PAY_NOTE: '',
      OPENER: 'You',
      MONEY_NOTE: 'Bounty holds your money until you approve the finished work.',
      CTA_URL: MANAGE,
      UNSUBSCRIBE_URL: SITE,
      PREFERENCES_URL: SITE,
      POSTAL_LINE: '',
    },
    body: () =>
      h1('Still need that done?') +
      p("{{{OPENER}}} started a post on Bounty but didn't publish it. If you started on your phone, your draft should be right where you left it.", 20) +
      tips(
        [
          ['Say it plainly.', '“Assemble a dresser” beats “Need help.”'],
          ['Name a fair price.', "You set it. People nearby decide if it's worth their time."],
          ['Add a photo', "if there's something to see."],
        ],
        'Three things that get a yes fast'
      ) +
      callout('{{{MONEY_NOTE}}}') +
      button('Finish my post', '{{{CTA_URL}}}'),
    footer: () => lifecycleFooter(),
    text: `Still need that done?

{{{OPENER}}} started a post on Bounty but didn't publish it. If you started on your phone, your draft should be right where you left it.

Three things that get a yes fast:
→ Say it plainly. "Assemble a dresser" beats "Need help."
→ Name a fair price. You set it. People nearby decide if it's worth their time.
→ Add a photo if there's something to see.

{{{MONEY_NOTE}}}

Finish my post: {{{CTA_URL}}}

${LIFECYCLE_TXT_FOOTER}`,
    samples: { realistic: { OPENER: 'Tashawn, you', PREHEADER_PAY_NOTE: " You won't pay until you hire." }, edge: {} },
  },

  // ------------------------------------------------------ universal (action)
  {
    key: 'notice-action',
    alias: 'bounty-v2-notice-action',
    name: 'Bounty v2 · Notification (with button)',
    replaces: ['generic inline buildEmail() layout in send-notification-email'],
    trigger: 'Every notification email that is not routed to a dedicated template and has a CTA (messages, applications, acceptance, completion, disputes, verification, payouts…)',
    audience: 'poster + hunter',
    kind: 'transactional',
    status: 'new; wire via EMAIL_DESIGN_V2 flag (see PR)',
    subject: 'There’s an update on Bounty',
    preheader: '{{{PREHEADER}}}',
    stamp: { label: '{{{STAMP_LABEL}}}', vars: true },
    vars: {
      STAMP_LABEL: 'Update',
      TONE_ACCENT: '#18A772',
      TONE_INK: '#0B6A31',
      TONE_TINT: '#E7F5EC',
      PREHEADER: '',
      HEADLINE: 'There’s an update on Bounty',
      BODY: '',
      CTA_LABEL: 'Open Bounty',
      CTA_URL: SITE,
      HELP_URL: 'mailto:support@bountyfinder.app',
      REASON_LINE: "You're getting this because of your notification settings in Bounty. Change them anytime under Settings › Notifications.",
      POSTAL_LINE: '',
    },
    body: () =>
      h1('{{{HEADLINE}}}') +
      lead('{{{BODY}}}') +
      button('{{{CTA_LABEL}}}', '{{{CTA_URL}}}') +
      small(`Need a hand? ${link('{{{HELP_URL}}}', 'Talk to a real person')}`, 18),
    footer: () => footer({ reason: '{{{REASON_LINE}}}', tagline: 'bountyfinder.net' }),
    text: `{{{HEADLINE}}}

{{{BODY}}}

{{{CTA_LABEL}}}: {{{CTA_URL}}}

Need a hand? Talk to a real person: {{{HELP_URL}}}

—
Bounty · bountyfinder.net
{{{REASON_LINE}}}
{{{POSTAL_LINE}}}`,
    samples: {
      realistic: {
        STAMP_LABEL: 'New message', PREHEADER: 'Hey! I can come by around 4. Does that work?',
        HEADLINE: 'Message from Jordan', BODY: '&ldquo;Hey! I can come by around 4. Does that work for the couch?&rdquo;',
        CTA_LABEL: 'Reply on bountyfinder.net', CTA_URL: MANAGE + '?bounty=00000000-0000-4000-8000-000000000000',
        REASON_LINE: "You're getting this because of your Messages notification settings in Bounty. Change them anytime under Settings › Notifications.",
      },
      applicant: {
        STAMP_LABEL: 'Your move', TONE_ACCENT: '#E39B2D', TONE_INK: '#7F4300', TONE_TINT: '#FFF1DC',
        PREHEADER: 'A hunter is waiting for your answer.',
        HEADLINE: '2 applicants are waiting on &quot;Deliver me food&quot;',
        BODY: '2 hunters applied to &quot;Deliver me food&quot; and are waiting for your answer. Use the button below to see who applied and accept or decline in your web browser — you don’t need the app. Unanswered applications close automatically. Replying to this email reaches our support team; it does not accept or decline anyone.',
        CTA_LABEL: 'Open on bountyfinder.net', CTA_URL: MANAGE + '?view=applicant',
      },
      edge: { HEADLINE: LONG_TITLE, BODY: LONG_TITLE + ' ' + LONG_TITLE },
    },
  },

  // -------------------------------------------------------- universal (info)
  {
    key: 'notice-info',
    alias: 'bounty-v2-notice-info',
    name: 'Bounty v2 · Notification (no button)',
    replaces: ['generic inline buildEmail() layout (no CTA case)'],
    trigger: 'Notification emails with no linkable destination (e.g. identity verification submitted/verified, payout paid, followers)',
    audience: 'poster + hunter',
    kind: 'transactional',
    status: 'new; wire via EMAIL_DESIGN_V2 flag (see PR)',
    subject: 'There’s an update on Bounty',
    preheader: '{{{PREHEADER}}}',
    stamp: { label: '{{{STAMP_LABEL}}}', vars: true },
    vars: {
      STAMP_LABEL: 'Update',
      TONE_ACCENT: '#18A772',
      TONE_INK: '#0B6A31',
      TONE_TINT: '#E7F5EC',
      PREHEADER: '',
      HEADLINE: 'There’s an update on Bounty',
      BODY: '',
      HELP_URL: 'mailto:support@bountyfinder.app',
      REASON_LINE: "You're getting this because of your notification settings in Bounty. Change them anytime under Settings › Notifications.",
      POSTAL_LINE: '',
    },
    body: () =>
      h1('{{{HEADLINE}}}') +
      lead('{{{BODY}}}') +
      small(`Questions? ${link('{{{HELP_URL}}}', 'Talk to a real person')}`, 18),
    footer: () => footer({ reason: '{{{REASON_LINE}}}', tagline: 'bountyfinder.net' }),
    text: `{{{HEADLINE}}}

{{{BODY}}}

Questions? Talk to a real person: {{{HELP_URL}}}

—
Bounty · bountyfinder.net
{{{REASON_LINE}}}
{{{POSTAL_LINE}}}`,
    samples: {
      realistic: { STAMP_LABEL: 'Verified', HEADLINE: 'You’re ID-verified', BODY: 'Your identity check is complete. Posters now see a verified badge on your profile when you apply.', PREHEADER: 'Posters now see a verified badge on your profile.' },
      payout_failed: { STAMP_LABEL: 'Action needed', TONE_ACCENT: '#D9473B', TONE_INK: '#9E2219', TONE_TINT: '#FCEAE8', HEADLINE: 'Your payout didn’t go through', BODY: 'Your bank returned the payout, so the money is back in your Bounty balance. Check your bank details in the app, then withdraw again.' },
      edge: { HEADLINE: LONG_TITLE, BODY: LONG_TITLE },
    },
  },
]

// ------------------------------------------------------------ Supabase Auth
// Sent by Supabase Auth (not Resend templates). Go-template placeholder:
// {{ .ConfirmationURL }}. Paste into Supabase → Authentication → Email
// Templates, or reference from supabase/config.toml for local dev.
const CONFIRM = '{{ .ConfirmationURL }}'
const authFooter = (reason) => footer({ reason, links: [['Get help', ASSETS.support]], postal: '' })
const linkFallback = small(`Button not working? Copy this link into your browser:<br><a href="${CONFIRM}" class="c-link" style="color:${C.greenInk};word-break:break-all;">${CONFIRM}</a>`, 18)

export const AUTH_TEMPLATES = [
  {
    key: 'auth-confirm-signup',
    alias: 'auth-confirm-signup',
    name: 'Supabase Auth · Confirm signup',
    trigger: 'Supabase Auth: email confirmation on signup',
    audience: 'everyone',
    kind: 'auth',
    status: 'new; paste into Supabase dashboard (replaces default "Confirm Your Signup")',
    subject: 'Confirm your email to start using Bounty',
    preheader: 'One tap and your account is ready.',
    stamp: { label: 'One quick step', tone: 'success' },
    vars: {},
    body: () =>
      h1("Confirm it's you.") +
      lead('Tap the button to confirm your email and finish setting up your Bounty account.') +
      button('Confirm my email', CONFIRM) +
      linkFallback +
      callout("Didn't sign up for Bounty? You can safely ignore this email.", 'Not you?', 'neutral'),
    footer: () => authFooter("You're getting this because someone signed up for Bounty with this address."),
    text: `Confirm it's you.

Tap the link to confirm your email and finish setting up your Bounty account:
${CONFIRM}

Didn't sign up for Bounty? You can safely ignore this email.

—
Bounty · Got a task? Drop a bounty.
Get help: support@bountyfinder.app`,
    samples: { realistic: {} },
  },
  {
    key: 'auth-magic-link',
    alias: 'auth-magic-link',
    name: 'Supabase Auth · Sign-in link',
    trigger: 'Supabase Auth: magic link / OTP sign-in (web poster sign-in)',
    audience: 'everyone',
    kind: 'auth',
    status: 'new; paste into Supabase dashboard (current subject "Your sign-in link" kept)',
    subject: 'Your sign-in link',
    preheader: 'Tap to sign in to Bounty. No password needed.',
    stamp: { label: 'Sign in', tone: 'neutral' },
    vars: {},
    body: () =>
      h1("Here's your sign-in link.") +
      lead('Tap below to sign in to Bounty. No password needed.') +
      button('Sign in to Bounty', CONFIRM) +
      small('This link works once and expires soon. If it has expired, request a new one from the sign-in page.', 16) +
      linkFallback +
      callout("Didn't ask for this? Someone may have typed your email by mistake. Ignore this email and your account stays as it is.", 'Not you?', 'neutral'),
    footer: () => authFooter("You're getting this because a sign-in link was requested for this address."),
    text: `Here's your sign-in link.

Tap to sign in to Bounty. No password needed:
${CONFIRM}

This link works once and expires soon. If it has expired, request a new one from the sign-in page.

Didn't ask for this? Ignore this email and your account stays as it is.

—
Bounty · Got a task? Drop a bounty.
Get help: support@bountyfinder.app`,
    samples: { realistic: {} },
  },
  {
    key: 'auth-reset-password',
    alias: 'auth-reset-password',
    name: 'Supabase Auth · Reset password',
    trigger: 'Supabase Auth: password recovery',
    audience: 'everyone',
    kind: 'auth',
    status: 'new; paste into Supabase dashboard',
    subject: 'Reset your Bounty password',
    preheader: 'Choose a new password. This link works once.',
    stamp: { label: 'Password reset', tone: 'neutral' },
    vars: {},
    body: () =>
      h1('Reset your password.') +
      lead('Tap below to choose a new password for your Bounty account.') +
      button('Choose a new password', CONFIRM) +
      small('This link works once and expires soon.', 16) +
      linkFallback +
      callout("Didn't request this? Ignore this email. Your password won't change unless you use this link.", 'Not you?', 'neutral'),
    footer: () => authFooter("You're getting this because a password reset was requested for this address."),
    text: `Reset your password.

Choose a new password for your Bounty account:
${CONFIRM}

This link works once and expires soon.

Didn't request this? Ignore this email. Your password won't change unless you use this link.

—
Bounty · Got a task? Drop a bounty.
Get help: support@bountyfinder.app`,
    samples: { realistic: {} },
  },
]
