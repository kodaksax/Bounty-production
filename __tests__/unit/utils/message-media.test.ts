import {
  getMediaKind,
  getMediaMimeType,
  isEmojiOnly,
  mediaExtension,
  mediaFileName,
  mediaPreviewLabel,
} from '../../../lib/utils/message-media';

const SUPABASE_IMAGE =
  'https://xwlwqzzphmmhghiqvkeu.supabase.co/storage/v1/object/public/bounty-attachments/messages/1756132003951-0-photo.jpg';

describe('message-media', () => {
  describe('mediaFileName', () => {
    it('returns the last path segment', () => {
      expect(mediaFileName(SUPABASE_IMAGE)).toBe('1756132003951-0-photo.jpg');
    });

    it('strips query strings and fragments', () => {
      expect(mediaFileName('https://cdn.example.com/a/b/pic.png?token=abc#top')).toBe('pic.png');
    });

    it('decodes percent-encoded names', () => {
      expect(mediaFileName('https://cdn.example.com/my%20photo.jpg')).toBe('my photo.jpg');
    });

    it('returns an empty string for missing input', () => {
      expect(mediaFileName(null)).toBe('');
      expect(mediaFileName(undefined)).toBe('');
    });
  });

  describe('mediaExtension', () => {
    it('lowercases the extension', () => {
      expect(mediaExtension('file://photo.JPEG')).toBe('jpeg');
    });

    it('returns an empty string when there is no extension', () => {
      expect(mediaExtension('content://media/external/images/1000012345')).toBe('');
    });
  });

  describe('getMediaKind', () => {
    it.each(['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'bmp'])(
      'classifies .%s as an image',
      (ext) => {
        expect(getMediaKind(`https://cdn.example.com/a.${ext}`)).toBe('image');
      }
    );

    it.each(['mp4', 'mov', 'm4v', 'webm'])('classifies .%s as a video', (ext) => {
      expect(getMediaKind(`https://cdn.example.com/a.${ext}`)).toBe('video');
    });

    it('falls back to file for documents and unknown types', () => {
      expect(getMediaKind('https://cdn.example.com/contract.pdf')).toBe('file');
      expect(getMediaKind('https://cdn.example.com/no-extension')).toBe('file');
      expect(getMediaKind(null)).toBe('file');
    });

    it('reads the mime type out of a data URI', () => {
      expect(getMediaKind('data:image/png;base64,iVBORw0KGgo=')).toBe('image');
      expect(getMediaKind('data:application/pdf;base64,JVBERi0=')).toBe('file');
    });

    it('ignores a query string when classifying', () => {
      expect(getMediaKind(`${SUPABASE_IMAGE}?token=xyz`)).toBe('image');
    });
  });

  describe('getMediaMimeType', () => {
    it('maps known extensions', () => {
      expect(getMediaMimeType('a.jpg')).toBe('image/jpeg');
      expect(getMediaMimeType('a.mov')).toBe('video/quicktime');
      expect(getMediaMimeType('a.pdf')).toBe('application/pdf');
    });

    it('falls back to octet-stream', () => {
      expect(getMediaMimeType('a.unknownext')).toBe('application/octet-stream');
      expect(getMediaMimeType(null)).toBe('application/octet-stream');
    });

    it('prefers the type declared by a data URI', () => {
      expect(getMediaMimeType('data:image/webp;base64,UklGRg==')).toBe('image/webp');
    });
  });

  describe('mediaPreviewLabel', () => {
    it('labels each media kind', () => {
      expect(mediaPreviewLabel(SUPABASE_IMAGE)).toBe('📷 Photo');
      expect(mediaPreviewLabel('https://cdn.example.com/clip.mp4')).toBe('🎥 Video');
      expect(mediaPreviewLabel('https://cdn.example.com/terms.pdf')).toBe('📎 Attachment');
    });
  });

  describe('isEmojiOnly', () => {
    it.each(['😀', '😀😀😀', '👍🏽', '👨‍👩‍👧‍👦', '🇺🇸', '❤️', '✅', '😀 🎉'])(
      'treats %s as emoji-only',
      (text) => {
        expect(isEmojiOnly(text)).toBe(true);
      }
    );

    it.each(['hello', 'hi 😀', '...', '123', '', '   ', 'ok!'])(
      'treats %j as not emoji-only',
      (text) => {
        expect(isEmojiOnly(text)).toBe(false);
      }
    );

    it('handles null and undefined', () => {
      expect(isEmojiOnly(null)).toBe(false);
      expect(isEmojiOnly(undefined)).toBe(false);
    });

    it('does not blow up a long wall of emoji into jumbo text', () => {
      expect(isEmojiOnly('😀'.repeat(25))).toBe(false);
    });

    it('ignores surrounding whitespace', () => {
      expect(isEmojiOnly('  🎉  ')).toBe(true);
    });
  });
});
