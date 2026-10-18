import { supabase, isSupabaseConfigured } from '../supabase';
import type { CapabilityCatalog, HunterCapability, HunterCapabilityInput } from '../capabilities';

export const CAPABILITY_UNAVAILABLE = 'Task capabilities are unavailable. Please try again after this feature is enabled.';

function check(error: { message?: string } | null): void {
  if (error) throw new Error(CAPABILITY_UNAVAILABLE);
}

export const capabilityService = {
  async catalog(taxonomyVersion?: number): Promise<CapabilityCatalog> {
    if (!isSupabaseConfigured) throw new Error(CAPABILITY_UNAVAILABLE);
    const versionQuery = supabase.from('capability_taxonomy_versions').select('version');
    const version = await (taxonomyVersion === undefined
      ? versionQuery.eq('active', true) : versionQuery.eq('version', taxonomyVersion)).single();
    check(version.error);
    if (!version.data) throw new Error(CAPABILITY_UNAVAILABLE);
    const taskQuery = supabase.from('capability_tasks').select('id,category,label,taxonomy_version').eq('taxonomy_version', version.data.version);
    const termQuery = supabase.from('capability_terms').select('id,label,kind,taxonomy_version').eq('taxonomy_version', version.data.version);
    const [tasks, terms, links] = await Promise.all([
      taxonomyVersion === undefined ? taskQuery.eq('active', true) : taskQuery,
      taxonomyVersion === undefined ? termQuery.eq('active', true) : termQuery,
      supabase.from('capability_task_terms').select('task_id,term_id,taxonomy_version').eq('taxonomy_version', version.data.version),
    ]);
    [tasks, terms, links].forEach(result => check(result.error));
    return { taxonomy_version: version.data.version, tasks: tasks.data || [], terms: terms.data || [], links: links.data || [] } as CapabilityCatalog;
  },
  async mine(): Promise<HunterCapability[]> {
    if (!isSupabaseConfigured) throw new Error(CAPABILITY_UNAVAILABLE);
    const result = await supabase.rpc('get_my_hunter_capabilities');
    check(result.error);
    return result.data || [];
  },
  async save(declarations: HunterCapabilityInput[], taxonomyVersion: number): Promise<void> {
    if (!isSupabaseConfigured) throw new Error(CAPABILITY_UNAVAILABLE);
    const { error } = await supabase.rpc('set_my_hunter_capabilities', {
      p_declarations: declarations, p_taxonomy_version: taxonomyVersion,
    });
    if (error?.message?.includes('taxonomy_version_changed')) {
      throw new Error('The task catalog changed. Reload capabilities and review your selections before saving.');
    }
    check(error);
  },
};
