// services/api/src/examples/monitoring-integration.ts
// Example integration of APM monitoring in business logic

import { businessMetrics } from '../monitoring/business-metrics';
import { createCustomSpan, recordBusinessMetric } from '../monitoring/opentelemetry';
import { logger } from '../services/logger';

// Example bounty creation with monitoring
export async function createBountyWithMonitoring(data: {
  userId: string;
  title: string;
  description: string;
  amount?: number;
}) {
  const span = createCustomSpan('bounty.create', {
    userId: data.userId,
    hasAmount: data.amount ? 'true' : 'false',
  });

  try {
    const bounty = {
      id: `bounty-${Date.now()}`,
      ...data,
      createdAt: new Date().toISOString(),
    };

    businessMetrics.trackBountyCreated(bounty.id, data.userId, data.amount);
    recordBusinessMetric('bounty.created', 1, { bountyId: bounty.id });

    logger.info({ bountyId: bounty.id }, 'Bounty created successfully');
    span?.end?.();

    return { success: true, bounty };
  } catch (error) {
    if (span && typeof span.recordException === 'function') {
      span.recordException(error);
    }
    if (span && typeof span.setStatus === 'function') {
      span.setStatus({ code: 2 });
    }
    span?.end?.();

    logger.error({ error, userId: data.userId }, 'Failed to create bounty');
    return { success: false, error };
  }
}
