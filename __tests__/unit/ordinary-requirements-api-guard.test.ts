import { rejectUnsupportedRequirements as fastifyGuard } from '../../services/api/src/utils/ordinary-requirements';
const { rejectUnsupportedRequirements: expressGuard } = require('../../api/lib/ordinary-requirements');

describe('unsupported API paths never silently discard requested requirements', () => {
  it.each([
    { requirements_payload: { task_id: 'organize_items', terms: [] } },
    { requirements_payload: null },
    { requirements_version: 1 },
    { requirements_taxonomy_version: 1 },
    { requirements_revision: 99 },
    { requirements_confirmed_at: '2026-10-14T00:00:00Z' },
    { requirements_provenance: 'verified' },
  ])('rejects structured writes before old schemas can strip their fields: %p', async body => {
    const next = jest.fn();
    const response: any = {
      status: jest.fn(() => response), json: jest.fn(),
      code: jest.fn(() => response), send: jest.fn(),
    };
    expressGuard({ body }, response, next);
    expect(response.status).toHaveBeenCalledWith(503);
    expect(next).not.toHaveBeenCalled();
    await fastifyGuard({ body } as any, response);
    expect(response.code).toHaveBeenCalledWith(503);
    expect(response.send).toHaveBeenCalledWith(expect.objectContaining({ code: 'REQUIREMENTS_UNAVAILABLE' }));
  });
  it.each([undefined, {}, { skills_required: 'Legacy free text', category: 'labor' }])('leaves old clients untouched: %p', async body => {
    const next = jest.fn();
    const response: any = { status: jest.fn(), code: jest.fn(), send: jest.fn() };
    expressGuard({ body }, response, next);
    expect(next).toHaveBeenCalledTimes(1);
    await fastifyGuard({ body } as any, response);
    expect(response.status).not.toHaveBeenCalled();
    expect(response.send).not.toHaveBeenCalled();
  });
});
