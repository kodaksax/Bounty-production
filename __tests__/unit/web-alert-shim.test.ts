/**
 * @jest-environment jsdom
 */
/**
 * Behaviour of stubs/react-native-web-alert.web.js -- the web implementation of
 * react-native's Alert that metro.config.cjs substitutes for react-native-web's
 * no-op (`class Alert { static alert() {} }`).
 *
 * This replaces a function the app calls ~509 times, and it is the only reason the
 * Shoal swarm can see an error path at all on web, so its behaviour is pinned here
 * rather than only its wiring (see metro-web-stubs.test.ts for that).
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const Alert = require('../../stubs/react-native-web-alert.web.js');

const dialog = () => document.querySelector('[data-testid="rnw-alert"]');
const buttons = () =>
  Array.from(document.querySelectorAll<HTMLButtonElement>('[data-testid="rnw-alert"] button'));
const clickButton = (text: string) => {
  const el = buttons().find((b) => b.textContent === text);
  if (!el) throw new Error('no button labelled "' + text + '" (have: ' + buttons().map((b) => b.textContent).join(', ') + ')');
  el.click();
};

describe('web Alert shim', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    delete (window as unknown as Record<string, unknown>).__BOUNTY_ALERTS__;
  });

  it('is not the upstream no-op', () => {
    expect(Alert.__bountyWebAlertShim).toBe(true);
    expect(Alert.default).toBe(Alert);
  });

  it('renders the title and message into the DOM', () => {
    Alert.alert('Payment failed', 'Your card was declined.');
    expect(dialog()).not.toBeNull();
    expect(dialog()!.textContent).toContain('Payment failed');
    expect(dialog()!.textContent).toContain('Your card was declined.');
  });

  it('exposes an accessible dialog, not just pixels', () => {
    Alert.alert('Delete this bounty?', 'This cannot be undone.');
    const el = dialog()!;
    expect(el.getAttribute('role')).toBe('alertdialog');
    expect(el.getAttribute('aria-modal')).toBe('true');
    const labelledBy = el.getAttribute('aria-labelledby')!;
    expect(document.getElementById(labelledBy)!.textContent).toBe('Delete this bounty?');
    const describedBy = el.getAttribute('aria-describedby')!;
    expect(document.getElementById(describedBy)!.textContent).toBe('This cannot be undone.');
  });

  it('defaults to a single OK button when none are given', () => {
    Alert.alert('Saved');
    expect(buttons().map((b) => b.textContent)).toEqual(['OK']);
  });

  it('runs the pressed button handler and closes', () => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    Alert.alert('Cancel bounty?', 'You will be refunded.', [
      { text: 'Keep it', style: 'cancel', onPress: onCancel },
      { text: 'Cancel bounty', style: 'destructive', onPress: onConfirm },
    ]);
    clickButton('Cancel bounty');
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    expect(dialog()).toBeNull();
  });

  it('reflects button style so destructive actions are distinguishable', () => {
    Alert.alert('Remove?', '', [
      { text: 'Keep', style: 'cancel' },
      { text: 'Remove', style: 'destructive' },
    ]);
    const styles = Object.fromEntries(
      buttons().map((b) => [b.textContent, b.getAttribute('data-alert-style')])
    );
    expect(styles).toEqual({ Keep: 'cancel', Remove: 'destructive' });
  });

  it('serializes alerts the way native does', () => {
    Alert.alert('First');
    Alert.alert('Second');
    expect(dialog()!.getAttribute('data-alert-title')).toBe('First');
    clickButton('OK');
    expect(dialog()!.getAttribute('data-alert-title')).toBe('Second');
    clickButton('OK');
    expect(dialog()).toBeNull();
  });

  it('shows an alert raised from another alert handler', () => {
    Alert.alert('Payment failed', '', [
      { text: 'Retry', onPress: () => Alert.alert('Still failing') },
    ]);
    clickButton('Retry');
    expect(dialog()!.getAttribute('data-alert-title')).toBe('Still failing');
  });

  it('dismisses on Escape only when cancelable', () => {
    const onDismiss = jest.fn();
    Alert.alert('Blocking', '', [{ text: 'OK' }], { cancelable: false, onDismiss });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(dialog()).not.toBeNull();
    clickButton('OK');
    expect(onDismiss).not.toHaveBeenCalled();

    const onCancelPress = jest.fn();
    Alert.alert('Dismissable', '', [{ text: 'Never mind', style: 'cancel', onPress: onCancelPress }], {
      onDismiss,
    });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(dialog()).toBeNull();
    expect(onCancelPress).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('focuses the affirmative action so keyboard users land inside the dialog', () => {
    Alert.alert('Fund this bounty?', '', [
      { text: 'Not now', style: 'cancel' },
      { text: 'Add funds' },
    ]);
    expect(document.activeElement?.textContent).toBe('Add funds');
  });

  it('records what the app said for the QA harness', () => {
    Alert.alert('Missing details', 'Add a price before posting.', [{ text: 'Got it' }]);
    clickButton('Got it');
    const log = (window as unknown as { __BOUNTY_ALERTS__: Array<Record<string, unknown>> })
      .__BOUNTY_ALERTS__;
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      title: 'Missing details',
      message: 'Add a price before posting.',
      buttons: ['Got it'],
      dismissedWith: 'Got it',
      via: 'button',
    });
  });

  it('caps the harness log so a long swarm run cannot grow it without limit', () => {
    for (let i = 0; i < 260; i++) {
      Alert.alert('Alert ' + i);
      clickButton('OK');
    }
    const log = (window as unknown as { __BOUNTY_ALERTS__: unknown[] }).__BOUNTY_ALERTS__;
    expect(log).toHaveLength(200);
    expect((log[log.length - 1] as { title: string }).title).toBe('Alert 259');
  });
});
