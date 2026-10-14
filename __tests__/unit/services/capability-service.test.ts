jest.mock('../../../lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));
import { supabase } from '../../../lib/supabase';
import { capabilityService, CAPABILITY_UNAVAILABLE } from '../../../lib/services/capability-service';

beforeEach(() => jest.clearAllMocks());

it('reads only the authenticated caller through a no-owner RPC', async () => {
  (supabase.rpc as jest.Mock).mockResolvedValue({ data: [], error: null });
  expect(await capabilityService.mine()).toEqual([]);
  expect(supabase.rpc).toHaveBeenCalledWith('get_my_hunter_capabilities');
});
it('persists explicit self-reports without owner or verification arguments', async () => {
  (supabase.rpc as jest.Mock).mockResolvedValue({ error: null });
  const declarations = [{ task_id: 'organize_items', term_id: 'organization', proficiency: 'comfortable' as const }];
  await capabilityService.save(declarations, 1);
  expect(supabase.rpc).toHaveBeenCalledWith('set_my_hunter_capabilities', { p_declarations: declarations, p_taxonomy_version: 1 });
});
it('fails closed on missing schema and does not invent successful local data', async () => {
  (supabase.rpc as jest.Mock).mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Missing RPC' } });
  await expect(capabilityService.mine()).rejects.toThrow(CAPABILITY_UNAVAILABLE);
  await expect(capabilityService.save([], 1)).rejects.toThrow(CAPABILITY_UNAVAILABLE);
});
it('loads only the active taxonomy version and surfaces catalog errors', async () => {
  const query: any = {
    select: jest.fn(() => query), eq: jest.fn(() => query),
    single: jest.fn().mockResolvedValue({ data: { version: 1 }, error: null }),
    then: (resolve: any) => resolve({ data: [], error: null }),
  };
  (supabase.from as jest.Mock).mockReturnValue(query);
  expect(await capabilityService.catalog()).toEqual({ taxonomy_version: 1, tasks: [], terms: [], links: [] });
  expect(query.eq).toHaveBeenCalledWith('active', true);
  expect(query.eq).toHaveBeenCalledWith('taxonomy_version', 1);
  query.single.mockResolvedValue({ data: null, error: { message: 'missing table' } });
  await expect(capabilityService.catalog()).rejects.toThrow(CAPABILITY_UNAVAILABLE);
});
it('rejects stale client declarations rather than reinterpreting them in the new active version', async () => {
  (supabase.rpc as jest.Mock).mockResolvedValue({ error: { message: 'taxonomy_version_changed' } });
  await expect(capabilityService.save([], 1)).rejects.toThrow('Reload capabilities and review');
});
it('reads historical labels by the submitted version rather than the current active taxonomy', async () => {
  const query: any = {
    select: jest.fn(() => query), eq: jest.fn(() => query),
    single: jest.fn().mockResolvedValue({ data: { version: 2 }, error: null }),
    then: (resolve: any) => resolve({ data: [], error: null }),
  };
  (supabase.from as jest.Mock).mockReturnValue(query);
  expect(await capabilityService.catalog(2)).toEqual({ taxonomy_version: 2, tasks: [], terms: [], links: [] });
  expect(query.eq).toHaveBeenCalledWith('version', 2);
  expect(query.eq).not.toHaveBeenCalledWith('active', true);
});
