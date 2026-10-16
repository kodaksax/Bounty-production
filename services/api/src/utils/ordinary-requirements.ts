import type { FastifyReply, FastifyRequest } from 'fastify';

/** Run before schema parsing: older API schemas otherwise discard these fields. */
export async function rejectUnsupportedRequirements(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = request.body;
  if (body && typeof body === 'object' &&
      ['requirements_payload', 'requirements_version', 'requirements_taxonomy_version',
        'requirements_revision', 'requirements_confirmed_at', 'requirements_provenance'].some(key =>
        Object.prototype.hasOwnProperty.call(body, key))) {
    await reply.code(503).send({
      code: 'REQUIREMENTS_UNAVAILABLE',
      error: 'Structured task requirements are unavailable through this API. Use the authenticated mobile posting flow.',
    });
  }
}
