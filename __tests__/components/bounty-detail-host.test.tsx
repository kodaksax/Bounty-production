/**
 * components/bounty-detail-host — the feed's bounty detail popup belongs to
 * the feed, not to the card that opened it, so it outlives that card's row.
 */
import { act, fireEvent, render } from '@testing-library/react-native';
import fs from 'fs';
import path from 'path';
import React, { useEffect } from 'react';
import { Text } from 'react-native';

jest.mock('../../components/bountydetailmodal', () => ({
  BountyDetailModal: ({ bounty, origin, onClose }: any) =>
    require('react').createElement(
      'Text',
      { testID: 'bounty-detail', onPress: onClose },
      `${bounty.title}|${origin ? 'from-card' : 'plain'}`
    ),
}));

import { BountyDetailHost, useBountyDetailHost } from '../../components/bounty-detail-host';

const ORIGIN = { x: 10, y: 20, width: 100, height: 80 };

function Card({ id, title }: { id: string; title: string }) {
  const host = useBountyDetailHost();
  useEffect(() => () => host?.cardGone(id), [host, id]);
  return (
    <Text testID={`card-${id}`} onPress={() => host?.open({ id, title }, ORIGIN)}>
      {title}
    </Text>
  );
}

function Feed({ ids }: { ids: string[] }) {
  return (
    <BountyDetailHost>
      {ids.map(id => (
        <Card key={id} id={id} title={`Bounty ${id}`} />
      ))}
    </BountyDetailHost>
  );
}

const detail = (view: ReturnType<typeof render>) => view.queryByTestId('bounty-detail')?.props.children;

describe('BountyDetailHost', () => {
  it('opens the tapped bounty, growing out of its card', () => {
    const view = render(<Feed ids={['1', '2']} />);
    fireEvent.press(view.getByTestId('card-2'));
    expect(detail(view)).toBe('Bounty 2|from-card');
  });

  it('keeps the popup when the card that opened it leaves the list', () => {
    const view = render(<Feed ids={['1', '2']} />);
    fireEvent.press(view.getByTestId('card-1'));

    view.rerender(<Feed ids={['2']} />);
    expect(view.queryByTestId('card-1')).toBeNull();
    expect(detail(view)).toBe('Bounty 1|plain');
  });

  it('ignores other cards leaving', () => {
    const view = render(<Feed ids={['1', '2']} />);
    fireEvent.press(view.getByTestId('card-1'));
    view.rerender(<Feed ids={['1']} />);
    expect(detail(view)).toBe('Bounty 1|from-card');
  });

  it('closes on the popup’s own close', () => {
    const view = render(<Feed ids={['1']} />);
    fireEvent.press(view.getByTestId('card-1'));
    act(() => fireEvent.press(view.getByTestId('bounty-detail')));
    expect(view.queryByTestId('bounty-detail')).toBeNull();
  });

  it('is absent outside a host, so cards open their own popup', () => {
    let seen: unknown = 'unset';
    function Probe() {
      seen = useBountyDetailHost();
      return null;
    }
    render(<Probe />);
    expect(seen).toBeNull();
  });
});

describe('feed cards', () => {
  // Every card the feed renders must hand its popup to the host; a card that
  // mounts its own again reintroduces the popup vanishing with its row.
  it.each(['bounty-list-item', 'bounty-compact-item', 'bounty-grid-item', 'bounty-featured-item'])(
    '%s opens its detail through the host when there is one',
    file => {
      const src = fs.readFileSync(path.resolve(__dirname, `../../components/${file}.tsx`), 'utf8');
      expect(src).toMatch(/useBountyDetailHost\(\)/);
      expect(src).toMatch(/detailHost\.open\(detailBounty, measured\)/);
      expect(src).toMatch(/detailHost\?\.cardGone\(String\(id\)\)/);
    }
  );
});
