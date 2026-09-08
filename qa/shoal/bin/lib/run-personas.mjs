/**
 * Per-run, per-agent personas: how one test account is bound to one swarm slot.
 *
 * The constraint (verified against Shoal at the pinned commit, not assumed):
 *
 *   - Shoal loads its persona library from ONE file inside its own package,
 *     `packages/core/personas/personas.yaml`. There is no --personas-file flag.
 *   - `pickPersonas(n, ids)` filters that library to `ids` and then cycles it:
 *     `pool[i % pool.length]`. So N DISTINCT ids across a swarm of N gives every
 *     agent a different persona object, deterministically.
 *   - `persona.profile` is interpolated verbatim into that agent's system prompt,
 *     and nothing else about an agent is per-slot.
 *
 * So the persona is the only per-agent channel Shoal has, and that is where an
 * agent's own credentials go. `setup.mjs` already merges Bounty's persona library
 * into that file the same way; this appends a second, run-scoped block on top of it
 * and removes it again when the run ends.
 *
 * Two things this deliberately does NOT do:
 *
 *   - It does not change each clone's `name`. Findings carry `personaName`, and both
 *     Shoal's report and qa/shoal/bin/report.mjs count reach by distinct persona
 *     NAME. Unique names per agent would inflate "3 personas hit this" into "8
 *     personas hit this" and destroy the friction map. The unique part is the id,
 *     which is all Shoal's selection needs.
 *   - It does not leave credentials behind: `removeRunPersonas` restores the file,
 *     and it is called from the runner's exit and signal paths, not just the happy
 *     one. A stale block from a killed run is also stripped before a new one is
 *     written, so a crash cannot strand credentials or poison the next run.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BEGIN = '  # ---- BEGIN shoal per-run agent personas';
const END = '  # ---- END shoal per-run agent personas ----';

function libraryPath(home) {
  return join(home, 'packages', 'core', 'personas', 'personas.yaml');
}

/**
 * Remove every per-run block from the persona library.
 *
 * Idempotent, and safe to call when no block is present -- which is the normal case
 * on the way in, and the whole point on the way out.
 *
 * @returns {boolean} whether anything was removed
 */
export function removeRunPersonas(home) {
  const path = libraryPath(home);
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return false; // no checkout / no library: nothing to clean up
  }
  let changed = false;
  for (;;) {
    const start = text.indexOf(BEGIN);
    if (start === -1) break;
    const end = text.indexOf(END, start);
    // A truncated block (killed mid-write) has no terminator; drop to end of file
    // rather than leaving half a persona -- and half a credential -- behind.
    const stop = end === -1 ? text.length : end + END.length;
    text = text.slice(0, start) + text.slice(stop);
    changed = true;
  }
  if (changed) writeFileSync(path, text.replace(/\n{3,}$/, '\n'), 'utf8');
  return changed;
}

/** YAML block scalars are whitespace-sensitive; keep the profile to plain indented lines. */
function indentBlock(text, indent) {
  return text
    .trim()
    .split(/\r?\n/)
    .map((line) => indent + line.trim())
    .join('\n');
}

/**
 * What the agent is told about its own account. Phrased as part of who it is, because
 * that is where it lands in the prompt, and stated exclusively so an agent cannot
 * decide to go and register a fresh one instead.
 */
function accountProfile(account) {
  return (
    'You already have an account on this site and you are signed out. Your account is ' +
    'email ' + account.email + ' with password ' + account.password + '. That account is ' +
    'yours alone -- always sign in with it, never register a new one, and never use any ' +
    'other email or password even if you see one somewhere. Everything you post, apply ' +
    'for or pay for belongs to this account.'
  );
}

/**
 * Install one persona per swarm slot, each a clone of a base persona carrying that
 * slot's account, and return the ids to pass to `--personas`.
 *
 * @param {string} home                 the pinned Shoal checkout
 * @param {object} opts
 * @param {string[]} opts.basePersonaIds the scenario's personas, cycled across the slots
 * @param {Array<{slot:number,email:string,password:string}>} opts.accounts one per slot
 * @param {string} opts.scenarioId
 * @param {string} opts.stamp           makes ids unique to this process
 * @returns {{ ids: string[], path: string }}
 */
export function installRunPersonas(home, { basePersonaIds, accounts, scenarioId, stamp }) {
  const path = libraryPath(home);

  // Clear anything a previous run left behind BEFORE reading, so a crashed run's block
  // can never be picked up as a base persona or re-appended.
  removeRunPersonas(home);
  const library = readFileSync(path, 'utf8');

  const bases = basePersonaIds.length > 0 ? basePersonaIds : [null];
  const entries = [];
  const ids = [];

  accounts.forEach((account, i) => {
    const baseId = bases[i % bases.length];
    const base = baseId ? readPersona(library, baseId) : null;
    if (baseId && !base) {
      throw new Error(
        'Persona "' + baseId + '" is not in Shoal\'s library at ' + path + '.\n' +
          '  Run: npm run qa:shoal:setup   (it merges qa/shoal/personas/bounty-personas.yaml)',
      );
    }
    const id = (baseId ?? 'bounty-agent') + '--run-' + stamp + '-' + String(account.slot).padStart(2, '0');
    ids.push(id);

    const fields = [
      '  - id: ' + id,
      '    emoji: "' + (base?.emoji ?? '\u{1F41F}') + '"',
      // Same NAME as the base persona on purpose -- reach metrics count distinct names.
      '    name: ' + JSON.stringify(base?.name ?? 'Shoal Agent'),
      '    patience_steps: ' + (base?.patience_steps ?? 25),
    ];
    if (base?.modality) fields.push('    modality: ' + base.modality);
    fields.push('    profile: |');
    const profile = [base?.profile?.trim(), accountProfile(account)].filter(Boolean).join('\n\n');
    fields.push(indentBlock(profile, '      '));
    entries.push(fields.join('\n'));
  });

  const block =
    '\n' + BEGIN + ' for "' + scenarioId + '" (run ' + stamp + ').\n' +
    '  #      Written by qa/shoal/bin/lib/run-personas.mjs and removed when the run ends.\n' +
    '  #      One account per swarm slot; do not edit or commit. ----\n' +
    entries.join('\n\n') + '\n' + END + '\n';

  writeFileSync(path, library.replace(/\s*$/, '') + '\n' + block, 'utf8');
  return { ids, path };
}

/**
 * Read one persona's scalar fields out of the library text.
 *
 * A deliberately small reader rather than a YAML dependency: qa/shoal/bin has no
 * node_modules of its own, and the only fields that need carrying over are the flat
 * ones plus `profile`. Anything it cannot parse falls back to a default above.
 */
function readPersona(library, id) {
  const lines = library.split(/\r?\n/);
  const start = lines.findIndex((l) => new RegExp('^\\s*-\\s*id:\\s*' + escapeRe(id) + '\\s*$').test(l));
  if (start === -1) return null;

  const indent = lines[start].indexOf('-');
  const out = { id };
  let profile = null;
  let profileIndent = null;

  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (profile !== null) {
      // Inside a block scalar: keep going while the line is blank or more-indented.
      if (line.trim() === '') {
        profile.push('');
        continue;
      }
      const lead = line.length - line.trimStart().length;
      if (profileIndent === null) profileIndent = lead;
      if (lead >= profileIndent) {
        profile.push(line.slice(profileIndent));
        continue;
      }
      break;
    }
    if (line.trim() === '') continue;
    const lead = line.length - line.trimStart().length;
    if (lead <= indent) break; // next list item or next top-level key
    const m = line.trim().match(/^([A-Za-z_]+):\s*(.*)$/);
    if (!m) continue;
    const [, key, rawValue] = m;
    if (key === 'profile') {
      // `profile: >` / `profile: |` open a block scalar; a quoted one-liner does not.
      if (rawValue === '' || rawValue === '>' || rawValue === '|' || /^[>|][-+]?$/.test(rawValue)) {
        profile = [];
      } else {
        out.profile = stripQuotes(rawValue);
      }
      continue;
    }
    if (key === 'patience_steps') out.patience_steps = Number(rawValue) || undefined;
    else out[key] = stripQuotes(rawValue);
  }

  if (profile) out.profile = profile.join('\n').trim();
  return out;
}

function stripQuotes(v) {
  const t = v.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
