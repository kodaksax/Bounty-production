/**
 * docs/ mixes public pages with internal audits and runbooks, and GitHub Pages
 * serves whatever the workflow uploads. Publishing must stay an explicit list,
 * and that list must not lose a page: the auth/ and wallet/ pages are redirect
 * targets, so dropping one breaks a live flow rather than a document.
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '../..');
const DOCS = path.join(ROOT, 'docs');
const workflow = fs.readFileSync(path.join(ROOT, '.github/workflows/deploy-pages.yml'), 'utf8');

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const publicPages = walk(DOCS)
  .filter(file => /\.(html|css)$/.test(file))
  .map(file => path.relative(DOCS, file).split(path.sep).join('/'))
  .sort();

/** Paths listed in the workflow's `cp --parents` step. */
function publishedFiles(): string[] {
  const start = workflow.indexOf('cp --parents');
  expect(start).toBeGreaterThanOrEqual(0);
  const end = workflow.indexOf('../_site/', start);
  expect(end).toBeGreaterThan(start);
  return workflow
    .slice(start + 'cp --parents'.length, end)
    .split('\n')
    .map(line => line.replace('\\', '').trim())
    .filter(Boolean)
    .sort();
}

describe('GitHub Pages publishing', () => {
  it('uploads the collected list, never the docs folder', () => {
    expect(workflow).toContain("path: './_site'");
    expect(workflow).not.toContain("path: './docs'");
  });

  it('publishes exactly the public pages in docs/', () => {
    expect(publishedFiles()).toEqual(publicPages);
  });

  it('never publishes internal documents', () => {
    for (const file of publishedFiles()) expect(file).not.toMatch(/\.(md|txt|patch)$/);
  });

  it('redeploys when the workflow itself changes', () => {
    expect(workflow).toContain("- '.github/workflows/deploy-pages.yml'");
  });
});
