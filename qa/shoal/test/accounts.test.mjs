/**
 * The per-agent account pool (qa/shoal/bin/lib/accounts.mjs) and the per-run persona
 * binding that delivers one account to one swarm slot
 * (qa/shoal/bin/lib/run-personas.mjs).
 *
 * These two are what make an authenticated scenario's state findings mean anything, so
 * the properties they rest on are pinned here: identity and passwords are derived
 * (seed.mjs and run.mjs must agree without a credential file), every slot is distinct,
 * and the persona block is installed and removed cleanly -- including after a crash,
 * because it holds credentials.
 *
 * No network, no database: `node --test qa/shoal/test/*.test.mjs`.
 */
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import {
  POOL_ROLES,
  POOL_SECRET_ENV,
  RESERVED_SLOT,
  derivePassword,
  fullPool,
  poolAccount,
  poolAccounts,
  requiredPoolSize,
  requirePoolSecret,
} from '../bin/lib/accounts.mjs';
import { installRunPersonas, removeRunPersonas } from '../bin/lib/run-personas.mjs';

const SECRET = 'test-secret-that-is-long-enough';

describe('account pool identity', () => {
  it('gives every slot its own address and username', () => {
    const accounts = poolAccounts('poster', 8);
    assert.equal(accounts.length, 8);
    assert.equal(new Set(accounts.map((a) => a.email)).size, 8);
    assert.equal(new Set(accounts.map((a) => a.username)).size, 8);
    // Slot 1, not 0: slot 0 is reserved for an operator to inspect by hand.
    assert.equal(accounts[0].slot, 1);
    assert.equal(accounts[0].email, 'qa+shoal-poster-01@bountyfinder.test');
    assert.equal(accounts[7].email, 'qa+shoal-poster-08@bountyfinder.test');
  });

  it('never collides across roles', () => {
    const emails = POOL_ROLES.flatMap((role) => poolAccounts(role, 10).map((a) => a.email));
    assert.equal(new Set(emails).size, emails.length);
  });

  it('is deterministic, so seed.mjs and run.mjs agree without a credential file', () => {
    assert.deepEqual(poolAccount('hunter', 3), poolAccount('hunter', 3));
    assert.equal(
      derivePassword(SECRET, 'qa+shoal-hunter-03@bountyfinder.test'),
      derivePassword(SECRET, 'qa+shoal-hunter-03@bountyfinder.test'),
    );
  });

  it('rejects an unknown role or an out-of-range slot rather than inventing an account', () => {
    assert.throws(() => poolAccount('admin', 1), /Unknown pool role/);
    assert.throws(() => poolAccount('poster', -1), /0\.\.99/);
    assert.throws(() => poolAccount('poster', 1.5), /0\.\.99/);
    assert.throws(() => poolAccounts('poster', 0), /positive integer/);
  });
});

describe('derived passwords', () => {
  it('differ per account and per secret', () => {
    const a = derivePassword(SECRET, 'qa+shoal-poster-01@bountyfinder.test');
    const b = derivePassword(SECRET, 'qa+shoal-poster-02@bountyfinder.test');
    const rotated = derivePassword('a-completely-different-secret', 'qa+shoal-poster-01@bountyfinder.test');
    assert.notEqual(a, b);
    assert.notEqual(a, rotated);
  });

  it('always satisfies an upper/lower/digit/symbol policy', () => {
    for (const role of POOL_ROLES) {
      for (const account of poolAccounts(role, 12)) {
        const pw = derivePassword(SECRET, account.email);
        assert.ok(pw.length >= 12, pw);
        assert.match(pw, /[A-Z]/);
        assert.match(pw, /[a-z]/);
        assert.match(pw, /[0-9]/);
        assert.match(pw, /[^A-Za-z0-9]/);
      }
    }
  });

  it('refuses to derive without a secret', () => {
    assert.throws(() => derivePassword('', 'x@y.test'), new RegExp(POOL_SECRET_ENV));
  });
});

describe('requirePoolSecret', () => {
  const original = process.env[POOL_SECRET_ENV];
  after(() => {
    if (original === undefined) delete process.env[POOL_SECRET_ENV];
    else process.env[POOL_SECRET_ENV] = original;
  });

  it('refuses a missing or too-short secret, and says how to make one', () => {
    delete process.env[POOL_SECRET_ENV];
    assert.throws(() => requirePoolSecret(), /is not set[\s\S]*randomBytes/);
    process.env[POOL_SECRET_ENV] = 'short';
    assert.throws(() => requirePoolSecret(), /too short/);
  });

  it('accepts a long enough secret', () => {
    process.env[POOL_SECRET_ENV] = SECRET;
    assert.equal(requirePoolSecret(), SECRET);
  });
});

describe('fullPool / requiredPoolSize', () => {
  it('covers both roles including the reserved slot', () => {
    const pool = fullPool(SECRET, 3);
    assert.equal(pool.length, POOL_ROLES.length * 4); // slots 0..3
    assert.ok(pool.some((a) => a.role === 'poster' && a.slot === RESERVED_SLOT));
    assert.ok(pool.every((a) => a.password));
  });

  it('sizes the pool from the largest authenticated scenario', () => {
    const scenarios = [
      { requiresAuth: false, swarm: 20 },
      { requiresAuth: true, swarm: 5 },
      { requiresAuth: true, swarm: 8 },
    ];
    assert.equal(requiredPoolSize(scenarios), 8);
    assert.equal(requiredPoolSize([{ requiresAuth: false, swarm: 9 }]), 1);
  });

  it('is big enough for every authenticated scenario actually in the registry', () => {
    const registry = JSON.parse(
      readFileSync(new URL('../scenarios/scenarios.json', import.meta.url), 'utf8'),
    ).scenarios;
    const needed = requiredPoolSize(registry);
    for (const s of registry.filter((x) => x.requiresAuth)) {
      assert.ok(
        s.swarm <= needed,
        'scenario ' + s.id + ' wants ' + s.swarm + ' accounts, pool sizes to ' + needed,
      );
    }
  });
});

// --- per-run personas -----------------------------------------------------

const LIBRARY_HEADER = `personas:
  - id: bounty-new-poster
    emoji: "\u{1F9FE}"
    name: New Poster Priya
    patience_steps: 26
    weight: 3
    profile: >
      You have a real errand you cannot do yourself today.
      You have never used this app before.

  - id: screenreader-sadie
    emoji: "\u{1F9BB}"
    name: Screenreader Sadie
    patience_steps: 30
    modality: a11y
    profile: |
      You navigate entirely by screen reader.
`;

const temps = [];
function fakeShoalHome() {
  const home = mkdtempSync(join(tmpdir(), 'shoal-personas-'));
  temps.push(home);
  const dir = join(home, 'packages', 'core', 'personas');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'personas.yaml'), LIBRARY_HEADER, 'utf8');
  return home;
}
const libraryOf = (home) => join(home, 'packages', 'core', 'personas', 'personas.yaml');

after(() => {
  for (const t of temps) rmSync(t, { recursive: true, force: true });
});

describe('per-run agent personas', () => {
  const accounts = [
    { slot: 1, email: 'qa+shoal-poster-01@bountyfinder.test', password: 'Sh0al!AAA' },
    { slot: 2, email: 'qa+shoal-poster-02@bountyfinder.test', password: 'Sh0al!BBB' },
    { slot: 3, email: 'qa+shoal-poster-03@bountyfinder.test', password: 'Sh0al!CCC' },
  ];

  it('creates one distinct persona id per swarm slot', () => {
    const home = fakeShoalHome();
    const { ids } = installRunPersonas(home, {
      basePersonaIds: ['bounty-new-poster'],
      accounts,
      scenarioId: 'state-breaker',
      stamp: 'test1',
    });
    assert.equal(ids.length, accounts.length);
    assert.equal(new Set(ids).size, accounts.length);

    const text = readFileSync(libraryOf(home), 'utf8');
    for (const id of ids) assert.match(text, new RegExp('- id: ' + id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });

  it('gives each persona exactly one account, and no other', () => {
    const home = fakeShoalHome();
    installRunPersonas(home, {
      basePersonaIds: ['bounty-new-poster'],
      accounts,
      scenarioId: 'state-breaker',
      stamp: 'test2',
    });
    const text = readFileSync(libraryOf(home), 'utf8');
    // Split the generated block into one chunk per persona and check the isolation
    // property directly: chunk i mentions account i and nobody else's.
    const chunks = text.split(/^\s*- id: /m).slice(1);
    const generated = chunks.filter((c) => c.includes('--run-test2-'));
    assert.equal(generated.length, accounts.length);
    generated.forEach((chunk, i) => {
      assert.ok(chunk.includes(accounts[i].email), 'slot ' + (i + 1) + ' is missing its own email');
      assert.ok(chunk.includes(accounts[i].password), 'slot ' + (i + 1) + ' is missing its own password');
      for (const other of accounts.filter((_, j) => j !== i)) {
        assert.ok(!chunk.includes(other.email), 'slot ' + (i + 1) + ' can see ' + other.email);
        assert.ok(!chunk.includes(other.password), 'slot ' + (i + 1) + ' can see another password');
      }
    });
  });

  it('keeps the base persona name so reach metrics still count real personas', () => {
    const home = fakeShoalHome();
    installRunPersonas(home, {
      basePersonaIds: ['bounty-new-poster'],
      accounts,
      scenarioId: 'state-breaker',
      stamp: 'test3',
    });
    const text = readFileSync(libraryOf(home), 'utf8');
    const names = [...text.matchAll(/^\s*name: (.+)$/gm)].map((m) => m[1].replace(/"/g, ''));
    // Two library personas + three clones, and every clone reuses the base name.
    assert.equal(names.filter((n) => n === 'New Poster Priya').length, 4);
  });

  it('carries the base profile and modality through to the clone', () => {
    const home = fakeShoalHome();
    installRunPersonas(home, {
      basePersonaIds: ['screenreader-sadie'],
      accounts: [accounts[0]],
      scenarioId: 'explore',
      stamp: 'test4',
    });
    const text = readFileSync(libraryOf(home), 'utf8');
    const clone = text.split(/^\s*- id: /m).find((c) => c.includes('--run-test4-'));
    assert.match(clone, /modality: a11y/);
    assert.match(clone, /You navigate entirely by screen reader\./);
    assert.match(clone, /patience_steps: 30/);
  });

  it('cycles the scenario personas across the slots', () => {
    const home = fakeShoalHome();
    const { ids } = installRunPersonas(home, {
      basePersonaIds: ['bounty-new-poster', 'screenreader-sadie'],
      accounts,
      scenarioId: 'explore',
      stamp: 'test5',
    });
    assert.ok(ids[0].startsWith('bounty-new-poster--run-'));
    assert.ok(ids[1].startsWith('screenreader-sadie--run-'));
    assert.ok(ids[2].startsWith('bounty-new-poster--run-'));
  });

  it('refuses a persona that is not in the library, rather than silently inventing one', () => {
    const home = fakeShoalHome();
    assert.throws(
      () =>
        installRunPersonas(home, {
          basePersonaIds: ['no-such-persona'],
          accounts,
          scenarioId: 'explore',
          stamp: 'test6',
        }),
      /not in Shoal's library[\s\S]*qa:shoal:setup/,
    );
  });

  it('restores the library exactly, leaving no credential behind', () => {
    const home = fakeShoalHome();
    const before = readFileSync(libraryOf(home), 'utf8');
    installRunPersonas(home, {
      basePersonaIds: ['bounty-new-poster'],
      accounts,
      scenarioId: 'state-breaker',
      stamp: 'test7',
    });
    assert.ok(readFileSync(libraryOf(home), 'utf8').includes(accounts[0].password));

    assert.equal(removeRunPersonas(home), true);
    const restored = readFileSync(libraryOf(home), 'utf8');
    for (const a of accounts) {
      assert.ok(!restored.includes(a.password), 'a password survived cleanup');
      assert.ok(!restored.includes(a.email), 'an email survived cleanup');
    }
    assert.equal(restored.trimEnd(), before.trimEnd());
    // Idempotent: a second cleanup (exit hook after a signal hook) is a no-op.
    assert.equal(removeRunPersonas(home), false);
  });

  it('strips a block a crashed run left behind before writing a new one', () => {
    const home = fakeShoalHome();
    installRunPersonas(home, {
      basePersonaIds: ['bounty-new-poster'],
      accounts,
      scenarioId: 'state-breaker',
      stamp: 'crashed',
    });
    // ...process dies here without cleaning up. The next run must not inherit it.
    const { ids } = installRunPersonas(home, {
      basePersonaIds: ['bounty-new-poster'],
      accounts,
      scenarioId: 'state-breaker',
      stamp: 'next',
    });
    const text = readFileSync(libraryOf(home), 'utf8');
    assert.ok(!text.includes('--run-crashed-'), 'the crashed run\'s personas were inherited');
    assert.equal(ids.filter((id) => id.includes('--run-next-')).length, accounts.length);
    assert.equal((text.match(/BEGIN shoal per-run agent personas/g) || []).length, 1);
  });

  it('cleans up a block that was truncated mid-write', () => {
    const home = fakeShoalHome();
    const before = readFileSync(libraryOf(home), 'utf8');
    writeFileSync(
      libraryOf(home),
      before + '\n  # ---- BEGIN shoal per-run agent personas for "x" (run y).\n  - id: half-written\n',
      'utf8',
    );
    assert.equal(removeRunPersonas(home), true);
    assert.equal(readFileSync(libraryOf(home), 'utf8').trimEnd(), before.trimEnd());
  });

  it('does nothing when there is no Shoal checkout to clean', () => {
    assert.equal(removeRunPersonas(join(tmpdir(), 'shoal-does-not-exist-' + Date.now())), false);
  });
});
