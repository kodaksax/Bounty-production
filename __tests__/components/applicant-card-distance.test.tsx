/**
 * SBA-02: the applicant card shows how far an in-person applicant is
 * ("About N mi away" / "Under 1 mi away") from the server-stamped
 * bounty_requests.distance_mi, and nothing when it isn't known. Rendered under
 * both real themes: the label uses the theme's secondary text colour.
 */
import { render } from '@testing-library/react-native';
import React from 'react';
import { StyleSheet } from 'react-native';
import { darkTheme } from '../../lib/themes/darkTheme';
import { lightTheme } from '../../lib/themes/lightTheme';

let mockTheme: any = lightTheme;
jest.mock('../../lib/themes/AppThemeContext', () => ({ useAppThemeContext: () => ({ theme: mockTheme }) }));
jest.mock('@expo/vector-icons/MaterialIcons', () => () => null);
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => '/tabs/postings-screen',
  useGlobalSearchParams: () => ({}),
}));
jest.mock('../../components/ui/verification-badge', () => ({ VerificationBadge: () => null }));
jest.mock('../../components/ui/avatar', () => {
  const R = require('react');
  const Pass = ({ children }: any) => R.createElement(R.Fragment, null, children);
  return { Avatar: Pass, AvatarImage: () => null, AvatarFallback: Pass };
});

import { ApplicantCard } from '../../components/applicant-card';

const makeRequest = (distance_mi: number | null | undefined) =>
  ({
    id: 'req-1',
    bounty_id: 'b-1',
    hunter_id: 'h-1',
    status: 'pending',
    created_at: '2026-10-19T00:00:00Z',
    distance_mi,
    is_far: typeof distance_mi === 'number' && distance_mi > 50,
    bounty: { id: 'b-1', title: 'Mount my TV', amount: 60, is_for_honor: false, work_type: 'in_person' },
    profile: { id: 'h-1', username: 'sam', hunterCompleted: 0, ratingCount: 0 },
  }) as any;

// The outermost styled <Text> whose text is `text`. In __DEV__, TextGuard
// wraps the raw string in an unstyled inner <Text> that inherits this style.
function textOf(node: any): string {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(textOf).join('');
  return textOf(node.children);
}
function findTextNode(tree: any, text: string): any {
  if (!tree || typeof tree !== 'object') return null;
  if (Array.isArray(tree)) {
    for (const t of tree) {
      const hit = findTextNode(t, text);
      if (hit) return hit;
    }
    return null;
  }
  if (tree.type === 'Text' && tree.props?.style && textOf(tree) === text) return tree;
  return findTextNode(tree.children, text);
}

const renderCard = (distance_mi: number | null | undefined) =>
  render(<ApplicantCard request={makeRequest(distance_mi)} onAccept={jest.fn()} onReject={jest.fn()} />);

describe.each([
  ['light', lightTheme],
  ['dark', darkTheme],
])('ApplicantCard distance label (%s theme)', (_name, theme) => {
  beforeEach(() => {
    mockTheme = theme;
  });

  it('shows "About N mi away" in the secondary text colour', () => {
    const { getByText, toJSON } = renderCard(4);
    expect(getByText('About 4 mi away')).toBeTruthy();
    const node = findTextNode(toJSON(), 'About 4 mi away');
    expect(StyleSheet.flatten(node?.props?.style)?.color).toBe(theme.textSecondary);
  });

  it('shows "Under 1 mi away" for 0', () => {
    const { getByText } = renderCard(0);
    expect(getByText('Under 1 mi away')).toBeTruthy();
  });

  it('still shows a far applicant\'s distance', () => {
    const { getByText } = renderCard(1504);
    expect(getByText('About 1504 mi away')).toBeTruthy();
  });

  it.each([null, undefined])('shows nothing when the distance is %s', distance => {
    const { queryByTestId, queryByText } = renderCard(distance);
    expect(queryByTestId('applicant-distance')).toBeNull();
    expect(queryByText(/mi away/)).toBeNull();
  });
});
