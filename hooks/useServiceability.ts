import { useEffect, useSyncExternalStore } from 'react';
import { resolveServiceability } from '../lib/services/serviceability-service';
import {
  getServiceabilityContext,
  subscribeServiceability,
  type RegionContext,
} from '../lib/utils/serviceable-region';

/** The service-area answer, updating when it resolves. */
export function useServiceability(): RegionContext {
  const context = useSyncExternalStore(
    subscribeServiceability,
    getServiceabilityContext,
    getServiceabilityContext
  );

  useEffect(() => {
    void resolveServiceability();
  }, []);

  return context;
}

export default useServiceability;
