export function createExpoMessage(to: string, opts: { title?: string; body?: string; data?: any; sound?: string } = {}) {
  const { title = '', body = '', data = {}, sound = 'default' } = opts
  return { to, title, body, data, sound }
}

export function createMessages(tokens: string[], opts?: { title?: string; body?: string; data?: any; sound?: string }) {
  return (tokens || []).map(t => createExpoMessage(t, opts))
}

export default createMessages
