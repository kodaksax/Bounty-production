jest.mock('../../../lib/services/storage-service', () => ({
  storageService: {
    uploadFile: jest.fn().mockResolvedValue({ success: true, url: 'https://example.test/obj' }),
  },
}));

import { attachmentService } from '../../../lib/services/attachment-service';
import { storageService } from '../../../lib/services/storage-service';

const uploadFile = storageService.uploadFile as jest.Mock;

describe('attachmentService.upload contentType forwarding', () => {
  beforeEach(() => uploadFile.mockClear());

  it('forwards a real MIME type as the storage contentType', async () => {
    await attachmentService.upload({ id: '1', name: 'a', uri: 'file:///a.jpg', mimeType: 'image/jpeg' } as any);
    expect(uploadFile.mock.calls[0][1].contentType).toBe('image/jpeg');
  });

  it.each(['image', 'video', '', undefined])(
    'omits a non-MIME value (%p) so storage-service sniffs the URI instead',
    async (mimeType) => {
      await attachmentService.upload({ id: '1', name: 'a', uri: 'file:///a.jpg', mimeType } as any);
      expect(uploadFile.mock.calls[0][1].contentType).toBeUndefined();
    }
  );
});
