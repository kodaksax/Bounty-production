const { storageService } = require('../../../lib/services/storage-service');

describe('upload flow (smoke)', () => {
  it('exposes uploadFiles function', async () => {
    expect(typeof storageService.uploadFiles).toBe('function');
  });
});
