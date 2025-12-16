// Simple logger shim used by services under lib/services
export const logger = {
  info: (msg: string, meta?: any) => console.error('[logger][info]', msg, meta ?? ''),
  warn: (msg: string, meta?: any) => console.error('[logger][warn]', msg, meta ?? ''),
  warning: (msg: string, meta?: any) => console.error('[logger][warning]', msg, meta ?? ''),
  error: (msg: string, meta?: any) => console.error('[logger][error]', msg, meta ?? ''),
};
