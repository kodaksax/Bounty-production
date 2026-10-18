import type { Bounty } from './database.types';
import { bountyService } from './bounty-service';
import { bountyRequestService } from './bounty-request-service';

/** Unlike legacy callbacks, a blocked/failed structured edit must reject. */
export async function saveStructuredBountyEdit(id: Bounty['id'], updates: Partial<Bounty>): Promise<Bounty> {
  const pending = await bountyRequestService.getAll({ bountyId: id, status: 'pending', throwOnError: true });
  if (pending?.length) throw new Error('Cannot change posting terms after an application.');
  const saved = await bountyService.update(id, updates);
  if (!saved) throw new Error('Requirements were not saved. Please try again.');
  return saved;
}
