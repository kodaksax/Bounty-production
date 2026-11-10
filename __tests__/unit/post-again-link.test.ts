/**
 * The Post-again deep link (lib/navigation/post-again-link.ts), the handoff to
 * the tab shell (lib/post-again/handoff.ts), and the post-sign-in redirect
 * allow-list that lets a signed-out link resume (post-login-redirect.ts).
 */

import {
  postAgainDeepLink,
  postAgainRoutePath,
  postAgainUniversalLink,
  safePostAgainRedirect,
} from 'lib/navigation/post-again-link';
import { safePostLoginRedirect } from 'lib/navigation/post-login-redirect';
import {
  __resetPostAgainHandoffForTests,
  emitPostAgainRequest,
  POST_AGAIN_REQUEST_TTL_MS,
  takePostAgainRequest,
} from 'lib/post-again/handoff';

const ID = '5e96aaed-1111-4222-8333-444455556666';

describe('post-again links', () => {
  it("uses the app's scheme and the claimed /bounty/* universal-link path", () => {
    expect(postAgainDeepLink(ID)).toBe(`bountyexpo-workspace://bounty/${ID}/post-again?source=email`);
    expect(postAgainUniversalLink(ID)).toBe(`https://bountyfinder.app/bounty/${ID}/post-again?source=email`);
    expect(postAgainRoutePath(ID)).toBe(`/bounty/${ID}/post-again`);
  });

  it('matches the scheme in app.json', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const appJson = require('../../app.json');
    expect(postAgainDeepLink(ID).startsWith(`${appJson.expo.scheme}://`)).toBe(true);
  });
});

describe('safePostAgainRedirect', () => {
  it('accepts exactly a post-again path, normalized', () => {
    expect(safePostAgainRedirect(`/bounty/${ID}/post-again`)).toBe(`/bounty/${ID}/post-again`);
    expect(safePostAgainRedirect(`/bounty/${ID.toUpperCase()}/post-again?source=email`)).toBe(
      `/bounty/${ID}/post-again?source=email`
    );
    expect(safePostAgainRedirect([`/bounty/${ID}/post-again/`])).toBe(`/bounty/${ID}/post-again`);
  });

  it.each([
    `https://evil.example/bounty/${ID}/post-again`,
    `//evil.example/bounty/${ID}/post-again`,
    `/bounty/not-a-uuid/post-again`,
    `/bounty/${ID}/post-again?source=email&next=https://evil.example`,
    `/bounty/${ID}/post-again?source=sms`,
    `/bounty/${ID}/post-again?source=email&source=email`,
    `/bounty/${ID}/post-again#x`,
    `/bounty/${ID}/cancel`,
    `/bounty/${ID}/post-again/extra`,
    '',
    null,
    42,
  ])('rejects %p', (value) => {
    expect(safePostAgainRedirect(value)).toBeNull();
  });

  it('is honoured after sign-in alongside the /manage handoff', () => {
    expect(safePostLoginRedirect(`/bounty/${ID}/post-again?source=email`)).toBe(
      `/bounty/${ID}/post-again?source=email`
    );
    expect(safePostLoginRedirect(`/manage/?bounty=${ID}`)).toBe(`/manage/?bounty=${ID}`);
    expect(safePostLoginRedirect('/tabs/bounty-app?tab=wallet')).toBeNull();
  });
});

describe('post-again handoff', () => {
  beforeEach(() => __resetPostAgainHandoffForTests());

  it('is taken once, by the user it was made for', () => {
    emitPostAgainRequest({ sourceBountyId: 'b1', userId: 'u1', startStep: 3 });
    expect(takePostAgainRequest('u2')).toBeNull();
    expect(takePostAgainRequest('u1')).toMatchObject({ sourceBountyId: 'b1', startStep: 3 });
    expect(takePostAgainRequest('u1')).toBeNull();
  });

  it('expires, so a much later shell never replays it', () => {
    emitPostAgainRequest({ sourceBountyId: 'b1', userId: 'u1', startStep: 3 }, 1_000);
    expect(takePostAgainRequest('u1', 1_000 + POST_AGAIN_REQUEST_TTL_MS + 1)).toBeNull();
  });

  it('gives each request a new nonce', () => {
    const a = emitPostAgainRequest({ sourceBountyId: 'b1', userId: 'u1', startStep: 3 });
    const b = emitPostAgainRequest({ sourceBountyId: 'b1', userId: 'u1', startStep: 3 });
    expect(b.nonce).not.toBe(a.nonce);
  });
});
