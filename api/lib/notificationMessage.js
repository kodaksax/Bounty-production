function createExpoMessage(to, { title = '', body = '', data = {}, sound = 'default' } = {}) {
  return { to, title, body, data, sound };
}

function createMessages(tokens = [], opts = {}) {
  return (tokens || []).map(t => createExpoMessage(t, opts));
}

module.exports = { createExpoMessage, createMessages };
