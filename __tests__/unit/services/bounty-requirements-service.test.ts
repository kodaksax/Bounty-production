import { readFileSync } from 'fs';
import { join } from 'path';
import { bountyService } from '../../../lib/services/bounty-service';
import { bountyRequestService } from '../../../lib/services/bounty-request-service';
import { saveStructuredBountyEdit } from '../../../lib/services/bounty-requirements-service';
jest.mock('../../../lib/services/bounty-service', () => ({ bountyService: { update: jest.fn() } }));
jest.mock('../../../lib/services/bounty-request-service', () => ({ bountyRequestService: { getAll: jest.fn() } }));

const updates = { requirements_payload: { taxonomy_version: 1, task_id: 'organize_items', terms: [] } };
beforeEach(() => {
  jest.clearAllMocks();
  (bountyRequestService.getAll as jest.Mock).mockResolvedValue([]);
  (bountyService.update as jest.Mock).mockResolvedValue({ id: 'b1', ...updates });
});
it('preserves requirements and returns only confirmed server success', async () => {
  expect(await saveStructuredBountyEdit('b1', updates)).toMatchObject({ id: 'b1', ...updates });
  expect(bountyService.update).toHaveBeenCalledWith('b1', updates);
});
it('rejects blocked application checks rather than resolving a modal success', async () => {
  (bountyRequestService.getAll as jest.Mock).mockResolvedValue([{ id: 'request' }]);
  await expect(saveStructuredBountyEdit('b1', updates)).rejects.toThrow('after an application');
  expect(bountyService.update).not.toHaveBeenCalled();
});
it('rejects unverifiable application checks without saving', async () => {
  (bountyRequestService.getAll as jest.Mock).mockRejectedValue(new Error('Network unavailable'));
  await expect(saveStructuredBountyEdit('b1', updates)).rejects.toThrow('Network unavailable');
  expect(bountyRequestService.getAll).toHaveBeenCalledWith({
    bountyId: 'b1', status: 'pending', throwOnError: true,
  });
  expect(bountyService.update).not.toHaveBeenCalled();
});
it.each([null, 'reject'])('rejects failed updates: %s', async failure => {
  if (failure === 'reject') (bountyService.update as jest.Mock).mockRejectedValue(new Error('requirements_frozen_after_application'));
  else (bountyService.update as jest.Mock).mockResolvedValue(null);
  await expect(saveStructuredBountyEdit('b1', { requirements_payload: null })).rejects.toThrow();
});
it.each(['app/tabs/postings-screen.tsx', 'app/tabs/inbox-screen.tsx', 'app/postings/[bountyId]/index.tsx'])(
  'routes structured edits outside legacy catch-and-swallow callbacks: %s', path => {
    const source = readFileSync(join(__dirname, '../../..', path), 'utf8');
    const callback = source.slice(source.indexOf('const handleSaveEdit'), source.indexOf('const handleSaveEdit') + 1300);
    expect(callback).toContain('if (updates.requirements_payload !== undefined)');
    expect(callback).toContain('await saveStructuredBountyEdit(');
    expect(callback.indexOf('await saveStructuredBountyEdit(')).toBeLessThan(callback.indexOf('try {'));
  });
