/**
 * Guards the two rules the follow-the-phone theme depends on:
 *  1. colour pairs that carry words stay readable in both themes, and
 *  2. no consumer screen paints a dark-only surface, which would flip a
 *     light-mode user to dark in the middle of a task.
 */
import fs from 'fs';
import path from 'path';

// The global jest.setup mock replaces AppThemeContext only, so the real
// theme objects are safe to import here.
import { darkTheme } from '../../../lib/themes/darkTheme';
import { lightTheme } from '../../../lib/themes/lightTheme';
import type { AppTheme } from '../../../lib/themes/types';

function luminance(hex: string): number {
  const v = hex.replace('#', '');
  const channel = (i: number) => {
    const c = parseInt(v.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const AA_TEXT = 4.5;

const TEXT_ON_SURFACE: [keyof AppTheme, keyof AppTheme][] = [
  ['text', 'background'],
  ['text', 'surface'],
  ['text', 'surfaceSecondary'],
  ['textSecondary', 'background'],
  ['textSecondary', 'surface'],
  ['textSecondary', 'surfaceSecondary'],
  ['primaryLight', 'background'],
  ['primaryLight', 'surface'],
  ['successText', 'successTint'],
  ['warningText', 'warningTint'],
  ['errorText', 'errorTint'],
  ['infoText', 'infoTint'],
  ['textSecondary', 'neutralTint'],
];

describe.each([
  ['light', lightTheme],
  ['dark', darkTheme],
])('%s theme contrast', (_name, theme) => {
  it.each(TEXT_ON_SURFACE)('%s on %s meets AA', (fg, bg) => {
    expect(contrast(theme[fg] as string, theme[bg] as string)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('keeps the brand green on primary fills', () => {
    expect(theme.primary.toUpperCase()).toBe('#008E2A');
    expect(theme.onPrimary.toUpperCase()).toBe('#FFFFFF');
  });
});

describe('brand palette', () => {
  it('uses the agreed creams in light mode', () => {
    expect(lightTheme.background.toUpperCase()).toBe('#F1EBE3');
    expect(lightTheme.border.toUpperCase()).toBe('#D7CBBD');
  });
});

describe('consumer screens', () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  const DARK_SURFACE = /backgroundColor:\s*['"]#(1b1e24|22262c|2a2e35|0b0f14)['"]/i;
  // Media viewers sit on a photo, so a fixed dark backdrop is correct there.
  const ALLOWED = new Set(['components/attachment-viewer-modal.tsx', 'app/_layout.tsx', 'app/auth/environment-error.tsx']);

  function collect(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(path.join(repoRoot, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (rel === 'app/admin' || rel === 'components/admin') continue;
        collect(rel, out);
      } else if (entry.name.endsWith('.tsx')) {
        out.push(rel);
      }
    }
    return out;
  }

  it('do not hard-code a dark surface', () => {
    const offenders = [...collect('app'), ...collect('components')].filter(
      file => !ALLOWED.has(file) && DARK_SURFACE.test(fs.readFileSync(path.join(repoRoot, file), 'utf8'))
    );
    expect(offenders).toEqual([]);
  });
});
