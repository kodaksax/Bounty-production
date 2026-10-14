import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import type { BountyRequirementsInput, CapabilityCatalog } from '../lib/capabilities';
import { capabilityService } from '../lib/services/capability-service';
import { useAppThemeContext } from '../lib/themes/AppThemeContext';

/** Read existing declarations even when editing is disabled for rollout. */
export function BountyRequirementsSummary({ value }: { value?: BountyRequirementsInput | null }) {
  const { theme } = useAppThemeContext();
  const [catalog, setCatalog] = useState<CapabilityCatalog | null>(null);
  useEffect(() => {
    let active = true;
    setCatalog(null);
    if (value) capabilityService.catalog(value.taxonomy_version).then(next => { if (active) setCatalog(next); }).catch(() => {});
    return () => { active = false; };
  }, [value]);
  if (!value) return null;
  return <View style={{ marginVertical: 12 }}>
    <Text style={{ color: theme.text, fontWeight: '600' }}>Poster-declared requirements</Text>
    <Text style={{ color: theme.text }}>{catalog?.tasks.find(task => task.id === value.task_id)?.label || value.task_id}</Text>
    {value.terms.map(term => <Text key={term.term_id} style={{ color: theme.text }}>
      {term.importance === 'required' ? 'Required' : 'Preferred'}: {catalog?.terms.find(item => item.id === term.term_id)?.label || term.term_id}
    </Text>)}
    <Text style={{ color: theme.textSecondary }}>Ordinary skills/tools only. These declarations are not verification.</Text>
  </View>;
}
