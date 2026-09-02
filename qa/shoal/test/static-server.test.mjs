/**
 * Regression tests for the static-export server's request resolution.
 *
 * These exist because of a concrete incident: the SPA fallback applied to every unmatched
 * request, so a missing JS chunk was answered with index.html at HTTP 200 and
 * `content-type: text/html`. The browser evaluated HTML as JavaScript, the module came
 * out `undefined`, and expo-router threw "Cannot destructure property 'ErrorBoundary' of
 * 'undefined'" with a dead Try Again button. Two swarm agents filed it as a critical
 * Bounty auth bug; it was the harness. The first case in each matrix below is that bug.
 *
 * Every case runs against BOTH path implementations. Node's `path` is platform-specific,
 * so a suite that only used the ambient one would silently skip win32 semantics on a Linux
 * runner and posix semantics on a Windows one -- and the traversal behaviour genuinely
 * differs between them (win32 clamps '/../x' to '\x'; posix keeps '../x'). Injecting the
 * implementation means one runner covers both.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import { isNavigationRequest, mimeFor, resolveFile } from '../bin/lib/static-server.mjs';

/** The two path implementations, exercised identically. */
const IMPLS = [
  { name: 'win32', p: path.win32, out: 'C:\\export' },
  { name: 'posix', p: path.posix, out: '/srv/export' },
];

/** A fake export tree: only these paths exist. */
function treeFor(p, out) {
  const files = new Set(
    [
      p.join(out, 'index.html'),
      p.join(out, 'tabs', 'bounty-app.html'),
      p.join(out, 'auth', 'sign-up-form.html'),
      p.join(out, '_expo', 'static', 'js', 'web', 'index-abc.js'),
      p.join(out, 'assets', 'logo.png'),
    ].map(String),
  );
  return {
    existsSync: (f) => files.has(String(f)),
    statSync: () => ({ isFile: () => true }),
  };
}

for (const { name, p, out } of IMPLS) {
  describe('resolveFile [' + name + ']', () => {
    const fs = treeFor(p, out);
    const resolve = (url, nav) => resolveFile(out, url, nav, fs, p);

    it('does NOT fall back to index.html for a missing asset (the ErrorBoundary bug)', () => {
      assert.equal(
        resolve('/_expo/static/js/web/MISSING.js', false),
        null,
        'a missing chunk must 404, never return the HTML shell',
      );
    });

    it('serves a real asset', () => {
      assert.equal(
        resolve('/_expo/static/js/web/index-abc.js', false),
        p.join(out, '_expo', 'static', 'js', 'web', 'index-abc.js'),
      );
    });

    it('serves the SPA shell for a client-only route (navigation)', () => {
      // /screens/CreateBounty is mounted by expo-router, not prerendered.
      assert.equal(resolve('/screens/CreateBounty', true), p.join(out, 'index.html'));
    });

    it('prefers a prerendered route file over the shell', () => {
      assert.equal(resolve('/tabs/bounty-app', true), p.join(out, 'tabs', 'bounty-app.html'));
    });

    it('serves the root', () => {
      assert.equal(resolve('/', true), p.join(out, 'index.html'));
    });

    it('ignores query strings and fragments', () => {
      assert.equal(resolve('/tabs/bounty-app?x=1#y', true), p.join(out, 'tabs', 'bounty-app.html'));
    });

    it('never resolves outside the export directory', () => {
      // The property under test is containment. A traversal attempt may legitimately
      // fall through to the SPA shell; what it must never do is reach a file outside.
      for (const url of [
        '/../secrets.env',
        '/a/../../etc/passwd',
        '/..%2fsecrets',
        '/%2e%2e/%2e%2e/x',
        '/....//....//etc/passwd',
      ]) {
        const got = resolve(url, true);
        if (got !== null) {
          assert.ok(String(got).startsWith(out), url + ' escaped the export dir: ' + got);
        }
      }
    });

    it('resolves a traversal attempt to the shell, not to a real outside file', () => {
      assert.equal(resolve('/../index.html', true), p.join(out, 'index.html'));
    });

    it('refuses malformed percent-encoding rather than throwing', () => {
      assert.equal(resolve('/%E0%A4%A', false), null);
    });

    it('an asset request that escapes is refused outright', () => {
      assert.equal(resolve('/../../etc/passwd.js', false), null);
    });
  });
}

describe('isNavigationRequest', () => {
  it('trusts Sec-Fetch-Mode: navigate', () => {
    assert.equal(isNavigationRequest({ url: '/anything', headers: { 'sec-fetch-mode': 'navigate' } }), true);
  });

  it('treats an explicit asset fetch as not a navigation', () => {
    assert.equal(
      isNavigationRequest({
        url: '/_expo/static/js/web/index-abc.js',
        headers: { 'sec-fetch-mode': 'no-cors', 'sec-fetch-dest': 'script' },
      }),
      false,
    );
  });

  it('falls back to extension + Accept when Sec-Fetch headers are absent', () => {
    assert.equal(isNavigationRequest({ url: '/tabs/bounty-app', headers: { accept: 'text/html' } }), true);
    assert.equal(isNavigationRequest({ url: '/a.js', headers: { accept: 'text/html' } }), false);
    assert.equal(isNavigationRequest({ url: '/tabs/bounty-app', headers: {} }), false);
  });

  it('tolerates a request with no headers object', () => {
    assert.equal(isNavigationRequest({ url: '/x' }), false);
  });
});

describe('mimeFor', () => {
  it('never labels JavaScript as HTML', () => {
    assert.match(mimeFor('/x/index-abc.js'), /javascript/);
    assert.match(mimeFor('/x/index.html'), /text\/html/);
    assert.equal(mimeFor('/x/thing.unknown'), 'application/octet-stream');
  });
});
