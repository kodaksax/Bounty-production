import React, { useEffect, useRef, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import type { CapabilityCatalog, HunterCapabilityInput, CapabilityProficiency, CapabilityExperience } from '../lib/capabilities';
import { HUNTER_CAPABILITIES_ENABLED } from '../lib/feature-flags';
import { capabilityService } from '../lib/services/capability-service';
import { analyticsService } from '../lib/services/analytics-service';
import { useAppThemeContext } from '../lib/themes/AppThemeContext';
import { useAuthContext } from '../hooks/use-auth-context';

export function CapabilityEditor() {
  const { session, isLoading } = useAuthContext();
  const userId = session?.user?.id;
  return HUNTER_CAPABILITIES_ENABLED && userId && !isLoading
    ? <EnabledCapabilityEditor key={userId} /> : null;
}

function EnabledCapabilityEditor() {
  const { theme } = useAppThemeContext();
  const [catalog, setCatalog] = useState<CapabilityCatalog | null>(null);
  const [declarations, setDeclarations] = useState<HunterCapabilityInput[]>([]);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [requiresReconfirmation, setRequiresReconfirmation] = useState(false);
  const [requiresReload, setRequiresReload] = useState(false);
  const mountedRef = useRef(false);
  const loadGenerationRef = useRef(0);
  const load = async () => {
    const generation = ++loadGenerationRef.current;
    setCatalog(null);
    setMessage('');
    try {
      const [nextCatalog, mine] = await Promise.all([capabilityService.catalog(), capabilityService.mine()]);
      if (!mountedRef.current || generation !== loadGenerationRef.current) return;
      setDeclarations(mine.filter(item => item.taxonomy_version === nextCatalog.taxonomy_version).map(({ task_id, term_id, proficiency, experience }) => ({
        task_id, term_id, ...(proficiency ? { proficiency } : {}), ...(experience ? { experience } : {}),
      })));
      setCatalog(nextCatalog);
      const hasHistorical = mine.some(item => item.taxonomy_version !== nextCatalog.taxonomy_version);
      setRequiresReconfirmation(hasHistorical);
      setRequiresReload(false);
      if (hasHistorical) {
        setMessage('The task catalog changed. Review and select capabilities again; prior declarations are not automatically converted.');
      }
    } catch (error) {
      if (!mountedRef.current || generation !== loadGenerationRef.current) return;
      setMessage(error instanceof Error ? error.message : 'Unable to load capabilities');
    }
  };
  useEffect(() => {
    mountedRef.current = true;
    void load();
    return () => {
      mountedRef.current = false;
      loadGenerationRef.current += 1;
    };
  }, []);
  const save = async () => {
    if (!mountedRef.current || requiresReload || requiresReconfirmation || !catalog) return;
    setSaving(true);
    setMessage('');
    try {
      await capabilityService.save(declarations, catalog.taxonomy_version);
      if (!mountedRef.current) return;
      setMessage('Self-reported capabilities saved');
      void analyticsService.trackEvent('capabilities_saved', { count: declarations.length });
    } catch (error) {
      if (!mountedRef.current) return;
      setMessage(error instanceof Error ? error.message : 'Unable to save capabilities');
      if (error instanceof Error && error.message.includes('task catalog changed')) setRequiresReload(true);
    } finally { if (mountedRef.current) setSaving(false); }
  };
  const button = (label: string, onPress: () => void, selected = false, blocked = false) => (
    <TouchableOpacity key={label} accessibilityRole="button" accessibilityLabel={label}
      accessibilityState={{ selected, disabled: saving || blocked }} disabled={saving || blocked} onPress={onPress}
      style={{ padding: 12, borderWidth: 1, borderColor: selected ? theme.primary : theme.border, borderRadius: 8, marginVertical: 3 }}>
      <Text style={{ color: theme.text }}>{label}</Text>
    </TouchableOpacity>
  );
  return (
    <View style={{ marginVertical: 12 }}>
      <Text style={{ color: theme.text, fontWeight: '600' }}>Ordinary task capabilities (optional)</Text>
      <Text style={{ color: theme.textSecondary }}>Self-reported, not verified. No credentials required. Existing free-text skills are unchanged.</Text>
      {!!message && <Text accessibilityRole="alert" style={{ color: theme.text }}>{message}</Text>}
      {!catalog ? button('Retry capability loading', () => { void load(); }) : <>
        {button('Reload capability catalog', () => { void load(); })}
        {requiresReconfirmation && button('Confirm replacing prior-version declarations with reviewed selections', () => {
          setRequiresReconfirmation(false);
          setMessage('Prior-version declarations will be replaced only when you save these reviewed selections.');
        })}
        {catalog.tasks.map(task => <View key={task.id} style={{ marginTop: 12 }}>
          <Text style={{ color: theme.text }}>{task.label}</Text>
          {catalog.links.filter(link => link.task_id === task.id).map(link => {
            const term = catalog.terms.find(item => item.id === link.term_id);
            if (!term) return null;
            const existing = declarations.find(item => item.task_id === task.id && item.term_id === term.id);
            const update = (change: Partial<HunterCapabilityInput>) => setDeclarations(current => current.map(item =>
              item.task_id === task.id && item.term_id === term.id ? { ...item, ...change } : item));
            return <View key={term.id}>
              {button(`${term.label} (${term.kind})`, () => setDeclarations(current => existing
                ? current.filter(item => !(item.task_id === task.id && item.term_id === term.id))
                : [...current, { task_id: task.id, term_id: term.id }]), !!existing)}
              {existing && <>
                <Text style={{ color: theme.textSecondary }}>Optional proficiency</Text>
                {(['beginner', 'comfortable', 'experienced'] as CapabilityProficiency[]).map(value =>
                  button(`${term.label}: ${value}`, () => update({ proficiency: existing.proficiency === value ? undefined : value }), existing.proficiency === value))}
                <Text style={{ color: theme.textSecondary }}>Optional experience</Text>
                {(['none', 'some', 'regular'] as CapabilityExperience[]).map(value =>
                  button(`${term.label}: ${value} experience`, () => update({ experience: existing.experience === value ? undefined : value }), existing.experience === value))}
              </>}
            </View>;
          })}
        </View>)}
        {button(saving ? 'Saving capabilities…' : 'Save self-reported capabilities', () => { void save(); },
          false, requiresReload || requiresReconfirmation)}
      </>}
    </View>
  );
}
