import { render, waitFor } from '@testing-library/react-native';

import { ConnectEmbeddedWebView } from '../../components/connect-embedded-webview';

const webViewPropsSpy = jest.fn();
const postMessageSpy = jest.fn();

jest.mock('../../lib/config/api', () => ({
  API_BASE_URL: 'https://example.supabase.co/functions/v1',
}));

jest.mock('react-native-webview', () => {
  const React = require('react');

  return {
    WebView: React.forwardRef((props: any, ref) => {
      React.useImperativeHandle(ref, () => ({
        postMessage: postMessageSpy,
      }));
      webViewPropsSpy(props);
      return null;
    }),
  };
});

describe('ConnectEmbeddedWebView', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    webViewPropsSpy.mockClear();
    postMessageSpy.mockClear();

    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

    (global as any).fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          clientSecret: 'cs_test_123',
          publishableKey: 'pk_test_123',
          accountId: 'acct_test_123',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => '<!doctype html><html><body>Stripe shell</body></html>',
      });
  });

  afterEach(() => {
    delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
    jest.clearAllMocks();
  });

  afterAll(() => {
    (global as any).fetch = originalFetch;
  });

  it('injects the embedded shell as HTML instead of navigating to a URI', async () => {
    render(<ConnectEmbeddedWebView authToken="test-token" component="onboarding" />);

    await waitFor(() => {
      expect(webViewPropsSpy).toHaveBeenCalled();
    });

    const lastProps = webViewPropsSpy.mock.calls.at(-1)?.[0];

    expect(lastProps.source).toEqual({
      html: '<!doctype html><html><body>Stripe shell</body></html>',
      baseUrl: 'https://example.supabase.co/functions/v1/connect/',
    });
    expect(lastProps.originWhitelist).toEqual(['*']);
    expect(lastProps.javaScriptEnabled).toBe(true);
    expect(lastProps.domStorageEnabled).toBe(true);

    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      'https://example.supabase.co/functions/v1/connect/create-account-session',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token',
        }),
      })
    );

    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      'https://example.supabase.co/functions/v1/connect/embedded?v=0&c=onboarding',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Accept: 'text/html,application/xhtml+xml',
          apikey: 'test-anon-key',
        }),
      })
    );
  });
});
