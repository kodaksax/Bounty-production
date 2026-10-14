export type CapabilityProficiency = 'beginner' | 'comfortable' | 'experienced';
export type CapabilityExperience = 'none' | 'some' | 'regular';
export interface HunterCapabilityInput {
  task_id: string;
  term_id: string;
  proficiency?: CapabilityProficiency;
  experience?: CapabilityExperience;
}
export interface HunterCapability extends HunterCapabilityInput {
  taxonomy_version: number;
  provenance: 'self_reported';
}
export interface BountyRequirementsInput {
  taxonomy_version: number;
  task_id: string;
  terms: { term_id: string; importance: 'required' | 'preferred' }[];
}
export interface CapabilityTask {
  id: string;
  category: string;
  label: string;
  taxonomy_version: number;
}
export interface CapabilityTerm {
  id: string;
  label: string;
  kind: 'skill' | 'tool';
  taxonomy_version: number;
}
export interface CapabilityCatalog {
  taxonomy_version: number;
  tasks: CapabilityTask[];
  terms: CapabilityTerm[];
  links: { task_id: string; term_id: string; taxonomy_version: number }[];
}

/** No evidence, credentials, legal eligibility or verification claims are accepted. */
export function validateRequirements(value: unknown): asserts value is BountyRequirementsInput | null {
  if (value === null) return;
  const object = value as BountyRequirementsInput;
  if (!object || typeof object !== 'object' || Array.isArray(object) ||
      Object.keys(object).some(key => !['taxonomy_version', 'task_id', 'terms'].includes(key)) ||
      !Number.isInteger(object.taxonomy_version) || object.taxonomy_version < 1 || object.taxonomy_version > 999999999 ||
      typeof object.task_id !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(object.task_id) ||
      !Array.isArray(object.terms) || object.terms.length > 12) {
    throw new Error('Invalid ordinary task requirements');
  }

  const seen = new Set<string>();
  for (const term of object.terms) {
    if (!term || typeof term !== 'object' || Array.isArray(term) ||
        Object.keys(term).some(key => !['term_id', 'importance'].includes(key)) ||
        typeof term.term_id !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(term.term_id) ||
        !['required', 'preferred'].includes(term.importance) || seen.has(term.term_id)) {
      throw new Error('Invalid or duplicate ordinary skill/tool requirement');
    }
    seen.add(term.term_id);
  }
}

export function requirementsFingerprint(value: BountyRequirementsInput | null | undefined): string {
  if (value == null) return 'null';
  validateRequirements(value);
  return JSON.stringify({ taxonomy_version: value.taxonomy_version, task_id: value.task_id,
    terms: [...value.terms].sort((a, b) => a.term_id.localeCompare(b.term_id)) });
}
