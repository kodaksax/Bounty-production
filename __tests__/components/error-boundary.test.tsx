/**
 * Tests for the global ErrorBoundary fallback UI and its technical-details
 * formatting/redaction helpers.
 *
 * These tests cover the production-visible "Show technical details"
 * disclosure added to triage release-build crashes:
 *   1. Disclosure is hidden by default and toggled by tapping the header.
 *   2. Panel is not rendered when neither rawError nor componentStack is present.
 *   3. Sensitive substrings (Bearer/JWT tokens, Stripe keys, URL query params)
 *      are redacted before rendering.
 *   4. Non-Error throwables (strings, plain objects, null) do not crash the
 *      formatter.
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { Text } from 'react-native';
import {
  ErrorBoundary,
  formatTechnicalDetails,
  redactSensitiveTechnicalDetails,
} from '../../lib/error-boundary';

// Silence the dev-mode console noise from componentDidCatch / React.
beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  (console.error as jest.Mock).mockRestore?.();
});

/**
 * Throws on first render so the boundary catches it. After the boundary
 * resets via "Try Again" we don't need to recover — the tests don't tap it.
 */
function Boom({ error }: { error: unknown }): React.ReactElement {
  throw error;
}

describe('redactSensitiveTechnicalDetails', () => {
  it('redacts Bearer tokens', () => {
    const out = redactSensitiveTechnicalDetails(
      'Authorization: Bearer abc.def-ghi_jkl+mno/pqr=='
    );
    expect(out).toContain('Bearer [REDACTED]');
    expect(out).not.toContain('abc.def-ghi_jkl');
  });

  it('redacts JWT tokens', () => {
    const out = redactSensitiveTechnicalDetails('failed with JWT eyJhbGciOi.payload.sig');
    expect(out).toContain('JWT [REDACTED]');
    expect(out).not.toContain('eyJhbGciOi.payload.sig');
  });

  it('redacts Stripe live and test keys', () => {
    const out = redactSensitiveTechnicalDetails(
      'auth=sk_live_AbCdEfG123 pub=pk_test_XyZ789'
    );
    expect(out).toContain('sk_[REDACTED]');
    expect(out).toContain('pk_[REDACTED]');
    expect(out).not.toContain('sk_live_AbCdEfG123');
    expect(out).not.toContain('pk_test_XyZ789');
  });

  it('strips query params from URLs but preserves the path', () => {
    const out = redactSensitiveTechnicalDetails(
      'fetch failed at https://api.example.com/v1/items?token=secret&id=42'
    );
    expect(out).toContain('https://api.example.com/v1/items?[REDACTED]');
    expect(out).not.toContain('token=secret');
  });

  it('redacts URL fragments (OAuth implicit-flow tokens live there)', () => {
    const out = redactSensitiveTechnicalDetails(
      'see https://example.com/x?secret=1#access_token=abc'
    );
    // Both query and fragment are redacted; path is preserved.
    expect(out).toContain('https://example.com/x?[REDACTED]#[REDACTED]');
    expect(out).not.toContain('access_token=abc');
    expect(out).not.toContain('secret=1');
  });

  it('redacts a fragment-only URL even when there is no query string', () => {
    const out = redactSensitiveTechnicalDetails(
      'callback at https://example.com/cb#id_token=xyz'
    );
    expect(out).toContain('https://example.com/cb#[REDACTED]');
    expect(out).not.toContain('id_token=xyz');
  });

  it('redacts bare JWTs without a Bearer/JWT prefix', () => {
    const out = redactSensitiveTechnicalDetails(
      'token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature_value'
    );
    expect(out).toContain('[JWT_REDACTED]');
    expect(out).not.toContain('eyJhbGciOiJIUzI1NiJ9');
  });

  it('does not redact plain text without sensitive markers', () => {
    const safe = 'TypeError: Cannot read property foo of undefined';
    expect(redactSensitiveTechnicalDetails(safe)).toBe(safe);
  });
});

describe('formatTechnicalDetails', () => {
  it('returns null when both error and componentStack are absent', () => {
    expect(formatTechnicalDetails(null, null)).toBeNull();
    expect(formatTechnicalDetails(undefined, null)).toBeNull();
  });

  it('formats a standard Error with name + message + truncated stack', () => {
    const err = new Error('boom');
    err.stack = ['Error: boom', '  at a', '  at b', '  at c'].join('\n');
    const out = formatTechnicalDetails(err, null);
    expect(out).toContain('Error: boom');
    expect(out).toContain('at a');
  });

  it('handles string throwables without crashing', () => {
    const out = formatTechnicalDetails('plain string error', null);
    expect(out).toContain('Error: plain string error');
  });

  it('handles plain-object throwables with name/message/stack fields', () => {
    const out = formatTechnicalDetails(
      { name: 'CustomFail', message: 'no good', stack: 'CustomFail: no good\n  at x' },
      null
    );
    expect(out).toContain('CustomFail: no good');
    expect(out).toContain('at x');
  });

  it('handles null/undefined fields on object throwables without throwing', () => {
    const out = formatTechnicalDetails({ message: null, stack: 42 } as unknown, null);
    expect(out).toContain('Error:');
  });

  it('truncates long stacks to roughly 8 lines plus a header', () => {
    const err = new Error('big');
    err.stack = ['Error: big', ...Array.from({ length: 50 }, (_, i) => `  at frame${i}`)].join(
      '\n'
    );
    const out = formatTechnicalDetails(err, null) as string;
    // Header line + blank separator + 8 stack lines = 10 lines max.
    expect(out.split('\n').length).toBeLessThanOrEqual(10);
    expect(out).not.toContain('frame20');
  });

  it('redacts sensitive content inside stacks', () => {
    const err = new Error('failed');
    err.stack =
      'Error: failed\n  at fetch https://api.example.com/x?token=secret\n  at sk_live_ABC';
    const out = formatTechnicalDetails(err, null) as string;
    expect(out).not.toContain('token=secret');
    expect(out).not.toContain('sk_live_ABC');
  });

  it('appends component stack when provided', () => {
    const out = formatTechnicalDetails(
      new Error('x'),
      '\n    in App\n    in ErrorBoundary'
    );
    expect(out).toContain('Component stack:');
    expect(out).toContain('in App');
  });
});

describe('ErrorBoundary fallback UI', () => {
  it('renders children when no error is thrown', () => {
    const { getByText } = render(
      <ErrorBoundary>
        <Text>child-ok</Text>
      </ErrorBoundary>
    );
    expect(getByText('child-ok')).toBeTruthy();
  });

  it('shows the friendly fallback and hides technical details by default', () => {
    // Use a message that hits TECHNICAL_ERROR_PATTERNS so the friendly UI
    // sanitises it away — that's exactly the case the disclosure exists to
    // surface (the user otherwise has no way to see the underlying message).
    const { getByText, queryByText, getByLabelText } = render(
      <ErrorBoundary>
        <Boom error={new Error('Cannot read property foo of undefined')} />
      </ErrorBoundary>
    );

    // Friendly UI is visible.
    expect(getByText('Something Went Wrong')).toBeTruthy();
    // Disclosure header is rendered (matched via accessibilityLabel on the
    // TouchableOpacity, not the Text child).
    expect(getByLabelText('Show technical details')).toBeTruthy();
    // The underlying technical message is NOT yet on screen.
    expect(queryByText(/Cannot read property foo of undefined/)).toBeNull();
  });

  it('reveals technical details when the disclosure is tapped', () => {
    const { queryByText, getByLabelText } = render(
      <ErrorBoundary>
        <Boom error={new Error('Cannot read property reveal of undefined')} />
      </ErrorBoundary>
    );

    fireEvent.press(getByLabelText('Show technical details'));

    expect(getByLabelText('Hide technical details')).toBeTruthy();
    expect(queryByText(/Cannot read property reveal of undefined/)).toBeTruthy();
  });

  it('hides technical details again when toggled off', () => {
    const { queryByText, getByLabelText } = render(
      <ErrorBoundary>
        <Boom error={new Error('Cannot read property toggle of undefined')} />
      </ErrorBoundary>
    );

    fireEvent.press(getByLabelText('Show technical details'));
    expect(queryByText(/Cannot read property toggle of undefined/)).toBeTruthy();

    fireEvent.press(getByLabelText('Hide technical details'));
    expect(queryByText(/Cannot read property toggle of undefined/)).toBeNull();
  });

  it('redacts sensitive substrings in the rendered details panel', () => {
    const err = new Error(
      'Cannot read property x of undefined https://api.example.com/x?token=topsecret'
    );
    // Pin the stack so the assertion is purely about redaction, not
    // jest-internal frame paths.
    err.stack =
      'Error: Cannot read property x of undefined https://api.example.com/x?token=topsecret';
    const { queryByText, getByLabelText } = render(
      <ErrorBoundary>
        <Boom error={err} />
      </ErrorBoundary>
    );

    fireEvent.press(getByLabelText('Show technical details'));

    // The literal secret should never reach the rendered tree.
    expect(queryByText(/topsecret/)).toBeNull();
  });

  it('does not crash on non-Error throwables', () => {
    const { getByText, getAllByText, getByLabelText } = render(
      <ErrorBoundary>
        <Boom error={'Cannot read property string of undefined'} />
      </ErrorBoundary>
    );

    // Friendly fallback still rendered, disclosure still available.
    expect(getByText('Something Went Wrong')).toBeTruthy();
    fireEvent.press(getByLabelText('Show technical details'));
    expect(getAllByText(/Cannot read property string of undefined/).length).toBeGreaterThan(0);
  });
});
