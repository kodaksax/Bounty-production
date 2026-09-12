/**
 * Portfolio PDFs used to be rendered with <OptimizedImage>, which cannot decode
 * a PDF — the modal showed the app's themed background instead of the document.
 * These cover the detection that now routes those items to the real PDF viewer.
 */
// react-native-webview ships untranspiled ESM and is not covered by the
// project's transformIgnorePatterns, so it is stubbed the same way the other
// WebView-backed component tests do it.
jest.mock('react-native-webview', () => ({ WebView: () => null }));

import { isPdfSource } from '../../../components/ui/pdf-preview';

describe('isPdfSource', () => {
  it('detects PDFs by mime type', () => {
    expect(isPdfSource({ mimeType: 'application/pdf', name: 'resume' })).toBe(true);
    expect(isPdfSource({ mimeType: 'APPLICATION/PDF' })).toBe(true);
  });

  it('detects PDFs by file name when the mime type is missing', () => {
    expect(isPdfSource({ name: 'portfolio.pdf' })).toBe(true);
    expect(isPdfSource({ name: 'Portfolio.PDF' })).toBe(true);
  });

  it('detects PDFs by url, including signed urls with query strings', () => {
    expect(isPdfSource({ url: 'https://example.com/storage/case-study.pdf' })).toBe(true);
    expect(isPdfSource({ url: 'https://example.com/case-study.pdf?token=abc123' })).toBe(true);
    expect(isPdfSource({ uri: 'file:///var/cache/local-copy.pdf' })).toBe(true);
  });

  it('does not treat other media as PDFs', () => {
    expect(isPdfSource({ mimeType: 'image/png', name: 'shot.png' })).toBe(false);
    expect(isPdfSource({ mimeType: 'video/mp4', url: 'https://example.com/clip.mp4' })).toBe(false);
    expect(isPdfSource({ name: 'notes.pdfx' })).toBe(false);
    expect(isPdfSource({ name: 'pdf-guide.docx' })).toBe(false);
    expect(isPdfSource(null)).toBe(false);
    expect(isPdfSource(undefined)).toBe(false);
  });
});
