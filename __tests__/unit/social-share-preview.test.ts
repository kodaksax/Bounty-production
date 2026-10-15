import fs from 'fs';
import path from 'path';
import { renderOgPage } from '../../supabase/functions/_shared/og-html';

const functionsRoot = path.resolve(__dirname, '../../supabase/functions');
const readFunction = (name: string) => fs.readFileSync(path.join(functionsRoot, name), 'utf8');

describe('public bounty sharing privacy contract', () => {
  it('does not read authenticated bounty data to generate a public page', () => {
    const source = readFunction('share-bounty/index.ts');
    expect(source).not.toMatch(/\.from\(['"]bounties['"]\)/);
    expect(source).not.toMatch(/bounty\.(title|description|location|username|attachments_json|amount)/);
    expect(source).toContain('type=bounty&id=_fallback');
    expect(source).toContain('/functions/v1/app-link/share/bounty?path=');
    expect(source).toContain('id6756679797');
  });

  it('never reads bounty rows even through the direct public image endpoint', () => {
    const source = readFunction('share-og-image/index.ts');
    const bountyPath = source.slice(0, source.indexOf("const { data: profile }"));
    expect(bountyPath).not.toMatch(/\.from\(['"]bounties['"]\)/);
    expect(source).not.toContain('attachments_json');
    expect(source).toContain("type === 'bounty' || id === '_fallback'");
    expect(source).toContain('#18a772');
    expect(source).toContain('#008e2a');
    expect(source).toContain('<circle r="48"');
    // Existing profile preview remains a separate path.
    expect(source).toContain(".from('profiles')");
  });

  it('keeps an accessible website fallback and tracked handoff without forced navigation', () => {
    const html = renderOgPage({
      title: 'Get help with Bounty',
      description: 'Post a task of your own.',
      imageUrl: 'https://example.test/card.png',
      canonicalUrl: 'https://bountyfinder.app/bounty/abc',
      appDeepLink: 'bountyexpo-workspace://bounty/abc',
      handoffUrl: 'https://example.test/app-link/share/bounty?path=bounty%2Fabc&medium=organic',
      websiteUrl: 'https://bountyfinder.net',
      iosStoreUrl: 'https://apps.apple.com/app/id6756679797',
    });
    expect(html).toContain('property="og:image"');
    expect(html).toContain('name="twitter:card"');
    expect(html).toContain('width="1200" height="630"');
    expect(html).toContain('href="https://bountyfinder.net"');
    expect(html).toContain('path=bounty%2Fabc&amp;medium=organic');
    expect(html).not.toContain('<script>');
    expect(html).toContain('Open in Bounty');
  });

  it('preserves the existing redirect behavior for other share pages', () => {
    const html = renderOgPage({
      title: 'Profile',
      description: 'Public profile',
      imageUrl: 'https://example.test/card.png',
      canonicalUrl: 'https://bountyfinder.app/profile/abc',
      appDeepLink: 'bountyexpo-workspace://profile/abc',
    });
    expect(html).toContain('<script>');
    expect(html).toContain('window.location.href = appUrl');
  });
});
