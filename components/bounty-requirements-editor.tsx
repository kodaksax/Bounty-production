import React, { useEffect, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import type { BountyRequirementsInput, CapabilityCatalog } from '../lib/capabilities';
import { HUNTER_CAPABILITIES_ENABLED } from '../lib/feature-flags';
import { BOUNTY_CATEGORIES } from '../lib/constants/bounty-categories';
import { capabilityService } from '../lib/services/capability-service';
import { useAppThemeContext } from '../lib/themes/AppThemeContext';

interface Props {
  category?: string;
  value?: BountyRequirementsInput | null;
  onChange: (category: string, value: BountyRequirementsInput | null) => void;
  disabled?: boolean;
}
export function BountyRequirementsEditor(props: Props) {
  return HUNTER_CAPABILITIES_ENABLED ? <EnabledRequirementsEditor {...props} /> : null;
}
function EnabledRequirementsEditor({ category, value, onChange, disabled }: Props) {
  const { theme } = useAppThemeContext();
  const [expanded, setExpanded] = useState(!!value);
  const [catalog, setCatalog] = useState<CapabilityCatalog | null>(null);
  const [error, setError] = useState('');
  const load = async () => {
    try { setCatalog(await capabilityService.catalog()); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'Requirements unavailable'); }
  };
  useEffect(() => { if (expanded) void load(); }, [expanded]);
  const button = (label: string, press: () => void, selected = false) =>
    <TouchableOpacity key={label} disabled={disabled} onPress={press} accessibilityRole="button"
      accessibilityLabel={label} accessibilityState={{ selected, disabled: !!disabled }}
      style={{ padding: 12, marginVertical: 3, borderWidth: 1, borderColor: selected ? theme.primary : theme.border, borderRadius: 8 }}>
      <Text style={{ color: theme.text }}>{label}</Text>
    </TouchableOpacity>;
  return <View style={{ marginVertical: 12 }}>
    {button(expanded ? 'Hide ordinary task requirements' : 'Add ordinary task requirements (optional)', () => setExpanded(!expanded))}
    {expanded && <>
      <Text style={{ color: theme.textSecondary }}>Declared skills and tools only, not verified eligibility. No additional posting step.</Text>
      {value && catalog && value.taxonomy_version !== catalog.taxonomy_version &&
        <Text style={{ color: theme.text }}>The task catalog changed. Reselect the task before changing requirements.</Text>}
      {!!error && <Text accessibilityRole="alert" style={{ color: theme.text }}>{error}</Text>}
      {!catalog ? button('Retry requirements loading', () => { void load(); }) : <>
        {BOUNTY_CATEGORIES.map(item => button(`Category: ${item.label}`, () => onChange(item.id, null), category === item.id))}
        {button('No structured requirements', () => onChange(category || '', null), !value)}
        {catalog.tasks.filter(task => task.category === category).map(task =>
          button(task.label, () => onChange(category || '', { taxonomy_version: catalog.taxonomy_version, task_id: task.id, terms: [] }),
            value?.task_id === task.id && value.taxonomy_version === catalog.taxonomy_version))}
        {value && catalog.links.filter(link => link.task_id === value.task_id).map(link => {
          const term = catalog.terms.find(item => item.id === link.term_id);
          if (!term) return null;
          const importance = value.terms.find(item => item.term_id === term.id)?.importance;
          return <View key={term.id}>
            <Text style={{ color: theme.text }}>{term.label} ({term.kind})</Text>
            {(['required', 'preferred'] as const).map(next => button(`${term.label}: ${next}`, () =>
              onChange(category || '', { ...value, terms: [
                ...value.terms.filter(item => item.term_id !== term.id),
                ...(importance === next ? [] : [{ term_id: term.id, importance: next }]),
              ] }), importance === next))}
          </View>;
        })}
      </>}
    </>}
  </View>;
}
