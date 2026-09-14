/**
 * Guardrail: React Native's KeyboardAvoidingView measures its frame against
 * the window, so inside a <Modal> it computes no overlap and the iOS keyboard
 * covers the input (GitHub #750 — Raise Dispute details; also Edit Posting).
 * Use components/ui/keyboard-avoiding.tsx instead; see
 * docs/KEYBOARD_AVOIDANCE_STANDARD.md.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const SCAN_DIRS = ['app', 'components'];

// Unreachable: only imported by components/chat-detail-screen.tsx, which no
// route renders (the messenger routes use app/tabs/chat-detail-screen.tsx).
const ALLOWLIST = new Set(['components/sticky-message-interface.tsx']);

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsxFiles(full));
    else if (entry.name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

/** True when a `<KeyboardAvoidingView` JSX element opens inside a `<Modal>` element. */
function nestsKavInModal(source: string): boolean {
  const code = source.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\/.*$/gm, '');
  const tag = /<(\/?)(Modal|KeyboardAvoidingView)\b/g;
  let modalDepth = 0;
  let match: RegExpExecArray | null;
  while ((match = tag.exec(code))) {
    const [, closing, name] = match;
    if (name === 'Modal') modalDepth += closing ? -1 : 1;
    else if (!closing && modalDepth > 0) return true;
  }
  return false;
}

describe('keyboard avoidance inside modals', () => {
  it('detects the broken pattern', () => {
    expect(nestsKavInModal('<Modal visible><KeyboardAvoidingView behavior="padding"/></Modal>')).toBe(true);
    expect(nestsKavInModal('<KeyboardAvoidingView>{x}</KeyboardAvoidingView><Modal>{y}</Modal>')).toBe(false);
  });

  it('never renders RN KeyboardAvoidingView inside a <Modal>', () => {
    const offenders = SCAN_DIRS.flatMap((d) => tsxFiles(path.join(ROOT, d)))
      .map((f) => path.relative(ROOT, f).split(path.sep).join('/'))
      .filter((rel) => !ALLOWLIST.has(rel))
      .filter((rel) => nestsKavInModal(fs.readFileSync(path.join(ROOT, rel), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
