import { COMMUNITY_GUIDELINES_TEXT } from '../../assets/legal/community-guidelines';
import { PRIVACY_TEXT } from '../../assets/legal/privacy';
import { TERMS_TEXT } from '../../assets/legal/terms';
import { parseLegalText, type LegalBlock } from '../../components/legal/LegalText';

// The parser is pure; stub the theme hook so the module loads without providers.
jest.mock('lib/themes/AppThemeContext', () => ({ useAppThemeContext: jest.fn() }));

function visibleText(blocks: LegalBlock[]): string[] {
  return blocks.flatMap(b => (b.kind === 'bullets' ? b.items : [b.text]));
}

describe('parseLegalText', () => {
  it('turns a leading "# " into a title instead of printing the hash', () => {
    const blocks = parseLegalText('# TERMS AND CONDITIONS\n\nBody text.');
    expect(blocks[0]).toEqual({ kind: 'title', text: 'TERMS AND CONDITIONS' });
    expect(blocks[1]).toEqual({ kind: 'paragraph', text: 'Body text.' });
  });

  it('treats one-line ALL-CAPS paragraphs as headings, not sentences', () => {
    const blocks = parseLegalText('CONTACT US\n\nEmail support@example.com today.');
    expect(blocks.map(b => b.kind)).toEqual(['heading', 'paragraph']);
  });

  it('marks the first of a repeated heading as a table-of-contents entry', () => {
    const blocks = parseLegalText('1. OUR SERVICES\n\n2. FEES\n\n1. OUR SERVICES\n\nText.\n\n2. FEES\n\nMore.');
    expect(blocks.map(b => b.kind)).toEqual(['toc', 'toc', 'heading', 'paragraph', 'heading', 'paragraph']);
  });

  it('splits "- " lines into a bullet list while keeping the lead-in', () => {
    const blocks = parseLegalText('We use data to:\n- run the app\n- keep it safe');
    expect(blocks).toEqual([
      { kind: 'paragraph', text: 'We use data to:' },
      { kind: 'bullets', items: ['run the app', 'keep it safe'] },
    ]);
  });

  it.each([
    ['terms', TERMS_TEXT],
    ['privacy', PRIVACY_TEXT],
    ['community guidelines', COMMUNITY_GUIDELINES_TEXT],
  ])('renders the shipped %s text with no raw markdown markers', (_name, text) => {
    const shown = visibleText(parseLegalText(text));
    expect(shown.length).toBeGreaterThan(5);
    for (const line of shown.join('\n').split('\n')) {
      expect(line).not.toMatch(/^#+\s/);
      expect(line).not.toMatch(/^\s*- /);
    }
  });

  it('renders every Terms section heading as a heading after its TOC entry', () => {
    const blocks = parseLegalText(TERMS_TEXT);
    const refunds = blocks.filter(b => b.kind !== 'bullets' && b.text === '7. REFUNDS POLICY');
    expect(refunds.map(b => b.kind)).toEqual(['toc', 'heading']);
  });
});

describe('Terms of Service refund wording', () => {
  // §7 used to say "All sales are final and no refund will be issued", which
  // contradicted §30's cancellation/refund promise and the escrow copy on
  // /legal/how-it-works (Shoal trust-audit 2026-09-19).
  it('no longer promises that no refund will ever be issued', () => {
    expect(TERMS_TEXT).not.toMatch(/no refund will be issued/i);
  });

  it('points §7 at the §30 escrow terms', () => {
    const section7 = TERMS_TEXT.split('7. REFUNDS POLICY')[2] ?? '';
    expect(section7.split('8. SOFTWARE')[0]).toMatch(/Section 30/);
  });
});
