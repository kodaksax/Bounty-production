/**
 * The helper's ID line (feat/helper-id-line). Posters read a missing ID line
 * as "not checked, and Bounty doesn't check", so it is always one line:
 *   verified     → "Stripe checked Ana's photo ID for Bounty"
 *   not verified → "Ana hasn't verified a photo ID yet"
 * with a "What Bounty checks" link to a sheet holding the DECISION text.
 *
 * Here: the words, the sheet, the jargon rule, and three of the surfaces
 * (person view D, the offers list, the hired stage's copy). Screen E and its
 * quick confirm are in accept-funding-gate.test.tsx; the hired stage on the
 * job page is in bounty-dashboard-senior-fixes.test.tsx.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { lightTheme } from '../../lib/themes/lightTheme';
import { JARGON } from '../helpers/jargon';

jest.mock('../../lib/themes/AppThemeContext', () => ({ useAppThemeContext: () => ({ theme: lightTheme }) }));
jest.mock('@expo/vector-icons/MaterialIcons', () => () => null);
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => '/tabs/postings-screen',
  useGlobalSearchParams: () => ({}),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../../components/ui/app-modal', () => ({
  AppModal: ({ visible, children }: { visible: boolean; children: React.ReactNode }) => (visible ? children : null),
}));
jest.mock('../../components/ui/avatar', () => {
  const R = require('react');
  const Pass = ({ children }: any) => R.createElement(R.Fragment, null, children);
  return { Avatar: Pass, AvatarImage: () => null, AvatarFallback: Pass };
});

import { ApplicantCard } from '../../components/applicant-card';
import { ApplicantProfile, IdCheckLine } from '../../components/poster';
import {
  describeIdLine,
  WHAT_BOUNTY_CHECKS,
  WHAT_BOUNTY_CHECKS_SHEET,
  WHAT_BOUNTY_CHECKS_TITLE,
  WHAT_BOUNTY_DOES_NOT_CHECK,
} from '../../lib/utils/id-check-copy';
import { describeApplicant, describePosterStage } from '../../lib/utils/poster-stage-copy';

/** The DECISION, word for word. A change here is a product decision, not a copy tweak. */
const DECISION_CHECKS =
  "Stripe checks a person's government photo ID for Bounty: that the ID is real, and that a live selfie matches the photo on it.";
const DECISION_DOES_NOT_CHECK = "Bounty doesn't run background checks, and doesn't check licenses, insurance or skills.";

const VERIFIED_ANA = "Stripe checked Ana's photo ID for Bounty";
const UNVERIFIED_ANA = "Ana hasn't verified a photo ID yet";

/** Every string a <Text> under `node` renders, in order. */
function textsIn(node: any): string[] {
  const out: string[] = [];
  const walk = (n: any) => {
    if (n == null) return;
    if (typeof n === 'string') return void out.push(n);
    if (Array.isArray(n)) return void n.forEach(walk);
    if (n.type === 'Text') {
      const t: string[] = [];
      const flat = (c: any) => (typeof c === 'string' ? t.push(c) : Array.isArray(c) ? c.forEach(flat) : c?.children?.forEach?.(flat));
      (n.children ?? []).forEach(flat);
      return void out.push(t.join(''));
    }
    (n.children ?? []).forEach(walk);
  };
  walk(node);
  return out;
}

/** Opens the sheet from `linkTestID` and returns its body text, title excluded. */
function openSheetBody(linkTestID: string): string[] {
  fireEvent.press(screen.getByTestId(linkTestID));
  const sheet = screen.getByTestId('what-bounty-checks-sheet');
  return textsIn(sheet.children).filter((t) => t !== WHAT_BOUNTY_CHECKS_TITLE);
}

describe('the words', () => {
  it('the DECISION text is exactly what the copy module holds, in order', () => {
    expect(WHAT_BOUNTY_CHECKS).toBe(DECISION_CHECKS);
    expect(WHAT_BOUNTY_DOES_NOT_CHECK).toBe(DECISION_DOES_NOT_CHECK);
    expect(WHAT_BOUNTY_CHECKS_SHEET).toEqual([DECISION_CHECKS, DECISION_DOES_NOT_CHECK]);
    expect(WHAT_BOUNTY_CHECKS_TITLE).toBe('What Bounty checks');
  });

  it('verified names the checker and what was checked', () => {
    expect(describeIdLine('Ana', true)).toEqual({ verified: true, icon: 'verified-user', text: VERIFIED_ANA });
    expect(describeIdLine('Ana Ruiz', true).text).toBe(VERIFIED_ANA);
  });

  it('not verified says so in words, without pronouns', () => {
    expect(describeIdLine('Ana', false)).toEqual({ verified: false, icon: 'badge', text: UNVERIFIED_ANA });
    expect(describeIdLine('Ana', false).text).not.toMatch(/\b(her|his|she|he)\b/i);
  });

  it('no name: "this person", never a placeholder or an empty name', () => {
    expect(describeIdLine(null, true).text).toBe("Stripe checked this person's photo ID for Bounty");
    expect(describeIdLine('  ', false).text).toBe("This person hasn't verified a photo ID yet");
  });

  it('jargon: the line, the link and the sheet read in plain words', () => {
    const all = [
      describeIdLine('Ana', true).text,
      describeIdLine('Ana', false).text,
      describeIdLine(null, true).text,
      describeIdLine(null, false).text,
      WHAT_BOUNTY_CHECKS_TITLE,
      ...WHAT_BOUNTY_CHECKS_SHEET,
    ];
    for (const text of all) expect(text).not.toMatch(JARGON);
  });
});

describe('IdCheckLine and the sheet', () => {
  it.each([
    [true, VERIFIED_ANA],
    [false, UNVERIFIED_ANA],
  ])('verified=%s: one line, and the link opens the DECISION text', (verified, line) => {
    render(<IdCheckLine name="Ana" verified={verified} />);
    expect(screen.getByTestId('helper-id-line-text')).toHaveTextContent(line);
    expect(screen.queryByTestId('what-bounty-checks-sheet')).toBeNull();
    expect(openSheetBody('helper-id-line-link')).toEqual([DECISION_CHECKS, DECISION_DOES_NOT_CHECK]);
  });

  it('the sheet closes', () => {
    render(<IdCheckLine name="Ana" verified />);
    fireEvent.press(screen.getByTestId('helper-id-line-link'));
    fireEvent.press(screen.getByTestId('what-bounty-checks-sheet-close'));
    expect(screen.queryByTestId('what-bounty-checks-sheet')).toBeNull();
  });
});

describe('person view (D): "What we know about Ana"', () => {
  const renderPerson = (verified: boolean) => {
    const v = describeApplicant({ profile: { username: 'Ana', ratingCount: 0 }, distance_mi: 2 }, { index: 0, total: 2, verified });
    render(<ApplicantProfile name={v.name} since={v.since} note={v.note} facts={v.facts as any} />);
    return v;
  };

  it.each([
    [true, VERIFIED_ANA],
    [false, UNVERIFIED_ANA],
  ])('verified=%s: the ID line comes first, with its link', (verified, line) => {
    const v = renderPerson(verified);
    expect(v.facts[0]).toMatchObject({ text: line, kind: 'id' });
    expect(v.facts.filter((f) => f.kind === 'id')).toHaveLength(1);
    expect(screen.getByText(line)).toBeTruthy();
    expect(openSheetBody('applicant-id-checks-link')).toEqual([DECISION_CHECKS, DECISION_DOES_NOT_CHECK]);
  });
});

describe('offers list (Postings → Requests)', () => {
  const makeRequest = (profile: Record<string, unknown> | null, trust_tier = 'standard') =>
    ({
      id: 'req-1',
      bounty_id: 'b-1',
      hunter_id: 'h-1',
      status: 'pending',
      created_at: '2026-11-20T00:00:00Z',
      distance_mi: 2,
      bounty: { id: 'b-1', title: 'Clear the garage', amount: 60, is_for_honor: false, work_type: 'in_person', trust_tier },
      profile,
    }) as any;
  const renderCard = (profile: Record<string, unknown> | null, trust_tier?: string) =>
    render(<ApplicantCard request={makeRequest(profile, trust_tier)} onAccept={jest.fn()} onReject={jest.fn()} />);

  it('verified (Stripe Identity): the verified line', () => {
    renderCard({ id: 'h-1', username: 'Ana', stripe_identity_status: 'verified' });
    expect(screen.getByTestId('applicant-id-line-text')).toHaveTextContent(VERIFIED_ANA);
    expect(openSheetBody('applicant-id-line-link')).toEqual([DECISION_CHECKS, DECISION_DOES_NOT_CHECK]);
  });

  it.each(['unstarted', 'processing', 'requires_input', 'canceled', undefined])(
    'stripe_identity_status=%s: the not-verified line, on any job',
    (status) => {
      renderCard({ id: 'h-1', username: 'Ana', stripe_identity_status: status });
      expect(screen.getByTestId('applicant-id-line-text')).toHaveTextContent(UNVERIFIED_ANA);
    }
  );

  it('a high-risk job says the same line, and the old "Not ID-verified" row is gone', () => {
    renderCard({ id: 'h-1', username: 'Ana', stripe_identity_status: 'unstarted' }, 'vulnerable_person');
    expect(screen.getByTestId('applicant-id-line-text')).toHaveTextContent(UNVERIFIED_ANA);
    expect(screen.queryByText('Not ID-verified')).toBeNull();
  });

  it('no profile came with the offer: no ID claim either way', () => {
    renderCard(null);
    expect(screen.queryByTestId('applicant-id-line')).toBeNull();
  });
});

describe('hired stage (G): the copy asks for the line', () => {
  const lifecycle = { status: 'in_progress', headline: '', explanation: '', nextStep: '', tone: 'info' } as any;
  const base = {
    bounty: { status: 'in_progress', amount: 60, accepted_by: 'h1', funding_mode: 'at_accept' },
    lifecycle,
    helperName: 'Ana',
    applicantCount: 0,
  } as any;

  it('working, and working on a change: shown', () => {
    expect(describePosterStage(base).show.helperIdLine).toBe(true);
    expect(describePosterStage({ ...base, submission: { status: 'revision_requested' } }).show.helperIdLine).toBe(true);
  });

  it('before anyone is hired: not shown (the person view and screen E have it)', () => {
    const open = describePosterStage({ ...base, bounty: { ...base.bounty, status: 'open', accepted_by: null }, lifecycle: { ...lifecycle, status: 'open' }, helperName: null, applicantCount: 2 });
    expect(open.show.helperIdLine).toBe(false);
  });
});
