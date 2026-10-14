// These legacy writes cannot execute the Supabase requirements transaction.
function rejectUnsupportedRequirements(req, res, next) {
  const body = req.body;
  if (body && typeof body === 'object' &&
      ['requirements_payload', 'requirements_version', 'requirements_taxonomy_version',
        'requirements_revision', 'requirements_confirmed_at', 'requirements_provenance'].some(key =>
        Object.prototype.hasOwnProperty.call(body, key))) {
    return res.status(503).json({
      code: 'REQUIREMENTS_UNAVAILABLE',
      error: 'Structured task requirements are unavailable through this API. Use the authenticated mobile posting flow.',
    });
  }
  return next();
}

module.exports = { rejectUnsupportedRequirements };
