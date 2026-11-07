/**
 * WebSocket lifecycle lines fired a server round trip on every foreground. They
 * stay local unless verbose logging is on, while errors must keep reaching the
 * server.
 */

const env = process.env as Record<string, string | undefined>;
const originalEnv = { NODE_ENV: env.NODE_ENV, VERBOSE: env.EXPO_PUBLIC_LOG_CLIENT_VERBOSE };

function loadMonitoring(verbose: boolean) {
  jest.resetModules();
  // monitoring.ts no-ops under NODE_ENV=test, which would make these vacuous.
  env.NODE_ENV = 'production';
  env.EXPO_PUBLIC_LOG_CLIENT_VERBOSE = verbose ? '1' : '';

  const rpc = jest.fn(async () => ({ error: null }));
  jest.doMock('../../../lib/supabase', () => ({ supabase: { rpc } }));
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const monitoring = require('../../../lib/services/monitoring');
  return { rpc, monitoring };
}

const flush = () => new Promise(resolve => setImmediate(resolve));

describe('logClientVerbose', () => {
  afterAll(() => {
    env.NODE_ENV = originalEnv.NODE_ENV;
    env.EXPO_PUBLIC_LOG_CLIENT_VERBOSE = originalEnv.VERBOSE;
  });

  it('makes no network call by default', async () => {
    const { rpc, monitoring } = loadMonitoring(false);

    monitoring.logClientVerbose('App became active, checking WebSocket connection');
    await flush();

    expect(rpc).not.toHaveBeenCalled();
  });

  it('ships the line when verbose logging is on', async () => {
    const { rpc, monitoring } = loadMonitoring(true);

    monitoring.logClientVerbose('App became active, checking WebSocket connection');
    await flush();

    expect(rpc).toHaveBeenCalledWith(
      'write_client_log',
      expect.objectContaining({
        p_level: 'info',
        p_message: 'App became active, checking WebSocket connection',
      })
    );
  });

  it('leaves error reporting on regardless of the flag', async () => {
    const { rpc, monitoring } = loadMonitoring(false);
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    await monitoring.logClientError('Error connecting to WebSocket', { attempt: 1 });

    expect(rpc).toHaveBeenCalledWith(
      'write_client_log',
      expect.objectContaining({ p_level: 'error', p_message: 'Error connecting to WebSocket' })
    );
    consoleError.mockRestore();
  });
});
