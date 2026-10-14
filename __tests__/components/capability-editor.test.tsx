import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { CapabilityEditor } from '../../components/capability-editor';
import { BountyRequirementsEditor } from '../../components/bounty-requirements-editor';
import { capabilityService } from '../../lib/services/capability-service';
import { analyticsService } from '../../lib/services/analytics-service';
import { EditPostingModal } from '../../components/edit-posting-modal';
import { BountyRequirementsSummary } from '../../components/bounty-requirements-summary';
jest.mock('../../hooks/useBountyExactLocation', () => ({ useBountyExactLocation: () => ({ exact: null }) }));
jest.mock('../../hooks/usePostingPolicy', () => ({ usePostingPolicy: () => ({ honorPostsEnabled: true, minimumAmount: 5 }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

jest.mock('../../lib/feature-flags', () => ({ HUNTER_CAPABILITIES_ENABLED: true }));
jest.mock('../../lib/services/capability-service', () => ({
  capabilityService: { catalog: jest.fn(), mine: jest.fn(), save: jest.fn() },
}));
jest.mock('../../lib/services/analytics-service', () => ({ analyticsService: { trackEvent: jest.fn() } }));

const catalog = {
  taxonomy_version: 1,
  tasks: [{ id: 'organize_items', category: 'labor', label: 'Organize items', taxonomy_version: 1 }],
  terms: [{ id: 'organization', label: 'Organization', kind: 'skill', taxonomy_version: 1 }],
  links: [{ task_id: 'organize_items', term_id: 'organization', taxonomy_version: 1 }],
};
beforeEach(() => {
  jest.clearAllMocks();
  (capabilityService.catalog as jest.Mock).mockResolvedValue(catalog);
  (capabilityService.mine as jest.Mock).mockResolvedValue([]);
  (capabilityService.save as jest.Mock).mockResolvedValue(undefined);
});
it('starts empty, persists selected declarations and only counts analytics', async () => {
  const view = render(<CapabilityEditor />);
  await waitFor(() => expect(view.getByText('Organization (skill)')).toBeTruthy());
  fireEvent.press(view.getByText('Organization (skill)'));
  fireEvent.press(view.getByText('Organization: comfortable'));
  fireEvent.press(view.getByText('Organization: some experience'));
  fireEvent.press(view.getByText('Save self-reported capabilities'));
  await waitFor(() => expect(view.getByText('Self-reported capabilities saved')).toBeTruthy());
  expect(capabilityService.save).toHaveBeenCalledWith([
    { task_id: 'organize_items', term_id: 'organization', proficiency: 'comfortable', experience: 'some' },
  ], 1);
  expect(analyticsService.trackEvent).toHaveBeenCalledWith('capabilities_saved', { count: 1 });
});
it('keeps edits open and reports failure without a save-success or analytics event', async () => {
  (capabilityService.save as jest.Mock).mockRejectedValue(new Error('Capabilities unavailable'));
  const view = render(<CapabilityEditor />);
  await waitFor(() => expect(view.getByText('Organization (skill)')).toBeTruthy());
  fireEvent.press(view.getByText('Organization (skill)'));
  fireEvent.press(view.getByText('Save self-reported capabilities'));
  await waitFor(() => expect(view.getByText('Capabilities unavailable')).toBeTruthy());
  expect(view.queryByText('Self-reported capabilities saved')).toBeNull();
  expect(analyticsService.trackEvent).not.toHaveBeenCalled();
  expect(view.getByText('Organization: comfortable')).toBeTruthy();
});
it('shows optional task questions without a new step and separates required/preferred', async () => {
  const onChange = jest.fn();
  const value = { taxonomy_version: 1, task_id: 'organize_items', terms: [] };
  const view = render(<BountyRequirementsEditor category="labor" value={value} onChange={onChange} />);
  await waitFor(() => expect(view.getByText('Organization: required')).toBeTruthy());
  fireEvent.press(view.getByText('Organization: preferred'));
  expect(onChange).toHaveBeenCalledWith('labor', { taxonomy_version: 1, task_id: 'organize_items', terms: [{ term_id: 'organization', importance: 'preferred' }] });
  fireEvent.press(view.getByText('Category: Tech'));
  expect(onChange).toHaveBeenLastCalledWith('tech', null);
});
it('never manufactures declarations if loading fails', async () => {
  (capabilityService.mine as jest.Mock).mockRejectedValue(new Error('Not available'));
  const view = render(<CapabilityEditor />);
  await waitFor(() => expect(view.getByText('Not available')).toBeTruthy());
  expect(view.queryByText('Save self-reported capabilities')).toBeNull();
});
it('details summary displays only ordinary poster declarations, not verification claims', async () => {
  const view = render(<BountyRequirementsSummary value={{
    taxonomy_version: 1, task_id: 'organize_items', terms: [{ term_id: 'organization', importance: 'required' }],
  }} />);
  await waitFor(() => expect(view.getByText('Required: Organization')).toBeTruthy());
  expect(view.getByText('Organize items')).toBeTruthy();
  expect(view.getByText('Ordinary skills/tools only. These declarations are not verification.')).toBeTruthy();
  expect(capabilityService.catalog).toHaveBeenCalledWith(1);
});
const bounty: any = {
  id: 'bounty-1', title: 'Organize household items', description: 'Sort the items into groups',
  category: 'labor', amount: 40, is_for_honor: false, location: '', poster_id: 'owner',
  requirements_payload: { taxonomy_version: 1, task_id: 'organize_items', terms: [] },
};
it('edit modal submits structured changes in its existing save and keeps failed edits open', async () => {
  const onClose = jest.fn();
  const onSave = jest.fn().mockRejectedValue(new Error('Requirements cannot change after an application'));
  const view = render(<EditPostingModal visible bounty={bounty} onClose={onClose} onSave={onSave} />);
  await waitFor(() => expect(view.getByText('Organization: required')).toBeTruthy());
  fireEvent.press(view.getByText('Organization: required'));
  fireEvent.press(view.getByText('Save Changes'));
  await waitFor(() => expect(view.getByText('Requirements cannot change after an application')).toBeTruthy());
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
    category: 'labor',
    requirements_payload: { taxonomy_version: 1, task_id: 'organize_items', terms: [{ term_id: 'organization', importance: 'required' }] },
  }));
  expect(onClose).not.toHaveBeenCalled();
});
it('edit modal omits unchanged structured fields so old-style title edits remain compatible', async () => {
  const onSave = jest.fn().mockResolvedValue(undefined);
  const view = render(<EditPostingModal visible bounty={bounty} onClose={jest.fn()} onSave={onSave} />);
  fireEvent.press(view.getByText('Save Changes'));
  await waitFor(() => expect(onSave).toHaveBeenCalled());
  expect(onSave.mock.calls[0][0]).not.toHaveProperty('requirements_payload');
});
it('does not silently reinterpret persisted declarations from an older taxonomy version', async () => {
  (capabilityService.mine as jest.Mock).mockResolvedValue([{
    taxonomy_version: 2, task_id: 'organize_items', term_id: 'organization', provenance: 'self_reported',
  }]);
  const view = render(<CapabilityEditor />);
  await waitFor(() => expect(view.getByText('The task catalog changed. Review and select capabilities again; prior declarations are not automatically converted.')).toBeTruthy());
  expect(view.queryByText('Organization: comfortable')).toBeNull();
  fireEvent.press(view.getByText('Save self-reported capabilities'));
  expect(capabilityService.save).not.toHaveBeenCalled();
  fireEvent.press(view.getByText('Organization (skill)'));
  fireEvent.press(view.getByText('Confirm replacing prior-version declarations with reviewed selections'));
  fireEvent.press(view.getByText('Save self-reported capabilities'));
  await waitFor(() => expect(capabilityService.save).toHaveBeenCalledWith([
    { task_id: 'organize_items', term_id: 'organization' },
  ], 1));
});
it('requires catalog reload after a stale-version rejection before retrying a write', async () => {
  (capabilityService.save as jest.Mock).mockRejectedValue(new Error('The task catalog changed. Reload capabilities and review your selections before saving.'));
  const view = render(<CapabilityEditor />);
  await waitFor(() => expect(view.getByText('Organization (skill)')).toBeTruthy());
  fireEvent.press(view.getByText('Organization (skill)'));
  fireEvent.press(view.getByText('Save self-reported capabilities'));
  await waitFor(() => expect(view.getByText('The task catalog changed. Reload capabilities and review your selections before saving.')).toBeTruthy());
  fireEvent.press(view.getByText('Save self-reported capabilities'));
  expect(capabilityService.save).toHaveBeenCalledTimes(1);
  (capabilityService.save as jest.Mock).mockResolvedValue(undefined);
  fireEvent.press(view.getByText('Reload capability catalog'));
  await waitFor(() => expect(capabilityService.catalog).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(view.getByText('Organization (skill)')).toBeTruthy());
  fireEvent.press(view.getByText('Save self-reported capabilities'));
  await waitFor(() => expect(capabilityService.save).toHaveBeenCalledTimes(2));
});
