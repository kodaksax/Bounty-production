/**
 * GitHub #806: admins could not see photos attached to a listing. The data is
 * shaped awkwardly in production, so these fixtures mirror real rows:
 * a JSON string inside jsonb, with a device-local `uri` and a public
 * `remoteUri`.
 */
import { isImageAttachment, parseBountyAttachments } from '../../lib/admin/bounty-attachments';

const PUBLIC = 'https://example.supabase.co/storage/v1/object/public/bounty-attachments';

const uploadedPhoto = {
  id: 'att-1',
  name: 'IMG_3355.png',
  uri: 'file:///var/mobile/Containers/Data/Application/X/Library/Caches/ImagePicker/1.png',
  remoteUri: `${PUBLIC}/u1/1.png`,
  mimeType: 'image/png',
  size: 807029,
  status: 'uploaded',
};

describe('parseBountyAttachments', () => {
  it('parses the double-encoded string production stores in jsonb', () => {
    const raw = JSON.stringify([uploadedPhoto]);
    const { viewable, unavailableCount } = parseBountyAttachments(raw);
    expect(unavailableCount).toBe(0);
    expect(viewable).toHaveLength(1);
    // The admin's device must load the public URL, never the poster's local path.
    expect(viewable[0].uri).toBe(`${PUBLIC}/u1/1.png`);
    expect(viewable[0].remoteUri).toBe(`${PUBLIC}/u1/1.png`);
    expect(isImageAttachment(viewable[0])).toBe(true);
  });

  it('also accepts an already-decoded array and a triple-quoted string', () => {
    expect(parseBountyAttachments([uploadedPhoto]).viewable).toHaveLength(1);
    expect(parseBountyAttachments(JSON.stringify(JSON.stringify([uploadedPhoto]))).viewable).toHaveLength(1);
  });

  it('counts entries that only have a device-local uri as unavailable', () => {
    const neverUploaded = { ...uploadedPhoto, id: 'att-2', remoteUri: undefined, status: 'failed' };
    const { viewable, unavailableCount } = parseBountyAttachments(JSON.stringify([uploadedPhoto, neverUploaded]));
    expect(viewable.map((a) => a.id)).toEqual(['att-1']);
    expect(unavailableCount).toBe(1);
  });

  it('treats empty, null and malformed values as no attachments', () => {
    for (const raw of [null, undefined, '', '[]', '"[]"', 'not json', '{"a":1}', 42]) {
      expect(parseBountyAttachments(raw)).toEqual({ viewable: [], unavailableCount: 0 });
    }
  });

  it('classifies non-image files so they render as rows, not thumbnails', () => {
    const pdf = { ...uploadedPhoto, id: 'att-3', name: 'quote.pdf', mimeType: 'application/pdf', remoteUri: `${PUBLIC}/q.pdf` };
    const [file] = parseBountyAttachments([pdf]).viewable;
    expect(isImageAttachment(file)).toBe(false);
  });
});
