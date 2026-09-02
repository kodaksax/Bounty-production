// services/api/src/routes/analytics.ts - Analytics routes for admin dashboard
//
// Every route in this module previously returned hardcoded fabricated data
// behind a "TODO: Fetch real analytics" comment:
//
//   GET /admin/analytics/metrics      -> totalUsers: 1250, revenueWeek: 3820.5,
//                                        a fixed topEvents list, ...
//   GET /admin/analytics/events       -> synthesised events with
//                                        `user_${Math.floor(Math.random()*100)}`
//   GET /admin/analytics/users/:id    -> the same fixed counts for every user
//   GET /admin/analytics/export       -> totalRevenue: 12450.75
//
// The production database holds 343 profiles, so /metrics was overstating the
// user base by roughly 4x. None of this was visibly broken: the admin
// analytics screen rendered the numbers as though they were real, and an
// operator had no way to tell they were not.
//
// Fabricated data is worse than no data on an operational surface, so these
// now return 501 rather than a plausible lie. The admin console reads its
// analytics directly from Supabase instead -- see lib/admin/adminAnalytics.ts,
// which counts the real tables. If these HTTP endpoints are needed again
// (for a web console or an export job), implement them against the database
// and delete this shim; do not restore the constants.
import { FastifyInstance } from 'fastify';
import { adminMiddleware, AuthenticatedRequest } from '../middleware/auth';
import { analyticsLogger } from '../services/logger';

const NOT_IMPLEMENTED = {
  error: 'Not implemented',
  message:
    'Analytics are served directly from the database by the admin console (lib/admin/adminAnalytics.ts). This HTTP endpoint previously returned hardcoded sample data and has been disabled rather than left to report fabricated figures.',
} as const;

/**
 * Register analytics routes.
 * All routes in this module require admin authentication.
 */
export async function registerAnalyticsRoutes(fastify: FastifyInstance) {
  const paths = [
    '/admin/analytics/metrics',
    '/admin/analytics/events',
    '/admin/analytics/users/:userId',
    '/admin/analytics/export',
  ];

  for (const path of paths) {
    fastify.get(path, { preHandler: adminMiddleware }, async (request: AuthenticatedRequest, reply) => {
      analyticsLogger.warn(
        { userId: request.user?.id, path },
        'Disabled analytics endpoint called; see lib/admin/adminAnalytics.ts'
      );
      return reply.code(501).send(NOT_IMPLEMENTED);
    });
  }
}
