// Minimal validator mock used by tests when the real 'validator' package
// is not installed in the test environment.
module.exports = {
  stripLow: (s) => s,
  escape: (s) => s,
  isEmail: (s) => Boolean(s && typeof s === 'string' && s.includes('@')),
  normalizeEmail: (s) => (typeof s === 'string' ? s.toLowerCase() : ''),
};
