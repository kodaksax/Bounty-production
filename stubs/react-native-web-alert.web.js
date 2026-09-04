/**
 * Web implementation of react-native's `Alert`, wired in metro.config.cjs for
 * platform === 'web'.
 *
 * react-native-web ships `class Alert { static alert() {} }` -- a literal no-op
 * (node_modules/react-native-web/dist/exports/Alert/index.js). This repo has ~509
 * `Alert.alert(...)` call sites, and they are where the app reports almost every
 * failure and asks for almost every confirmation: validation errors, payment
 * failures, "are you sure you want to cancel this bounty", sign-in errors, upload
 * errors. On web, every one of them is swallowed in silence.
 *
 * That is not merely cosmetic for the web target. The Shoal swarm (qa/shoal) drives
 * the web build with a real browser and can only report what it can see, so with the
 * upstream no-op an error path is indistinguishable from a control that does nothing
 * -- which is exactly what the swarm kept filing ("Post Bounty button silently does
 * nothing"). Error-path findings are impossible to produce, and genuine silent
 * failures cannot be told apart from suppressed messages.
 *
 * So this renders the dialog for real, in the DOM, matching the behaviour of the
 * native Alert the product actually ships:
 *
 *   - modal and serialized: a second alert queues behind the first, as on native.
 *   - `buttons` become real <button>s labelled with their `text`; `onPress` fires.
 *   - `style: 'cancel' | 'destructive'` is honoured for placement and appearance.
 *   - `options.cancelable !== false` allows Escape / backdrop dismissal, which calls
 *     the cancel button's `onPress` (Android behaviour) and `options.onDismiss`.
 *   - it is a real `role="alertdialog"` with an accessible name and focused buttons,
 *     so Shoal's accessibility-tree modality (the screenreader personas) perceives it
 *     too, not just the pixel-based ones.
 *
 * It also keeps a capped log at `window.__BOUNTY_ALERTS__` so the QA harness has a
 * machine-readable record of what the app said, rather than depending on an agent
 * having transcribed it correctly.
 *
 * `Alert.prompt` is deliberately NOT implemented: it is iOS-only, this repo already
 * treats it as non-portable (see components/ui/mfa-code-modal.tsx), and providing it
 * on web would invite new call sites that break on Android.
 *
 * Native builds never see this file.
 */

/** How many past alerts to keep for the QA harness. Bounded so a long run cannot grow without limit. */
const LOG_LIMIT = 200;

/** Above react-native-web's own modal/overlay layers, which top out far below this. */
const Z_INDEX = 2147483000;

const STYLE_ELEMENT_ID = 'bounty-web-alert-styles';

/**
 * Injected once, lazily -- never at module scope. The static web export prerenders
 * every route in Node (app.json `web.output: "static"`), where `document` does not
 * exist, and this module is evaluated during that pass.
 */
const CSS = `
.bwa-backdrop {
  position: fixed; inset: 0; z-index: ${Z_INDEX};
  display: flex; align-items: center; justify-content: center;
  background: rgba(17, 24, 28, 0.55); padding: 24px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}
.bwa-dialog {
  background: #ffffff; color: #11181c; border-radius: 14px;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.32);
  width: 100%; max-width: 420px; overflow: hidden;
}
.bwa-body { padding: 22px 24px 18px; }
.bwa-title { margin: 0; font-size: 18px; line-height: 1.3; font-weight: 700; }
.bwa-message { margin: 10px 0 0; font-size: 15px; line-height: 1.45; color: #38434a; white-space: pre-wrap; }
.bwa-message:empty { display: none; }
.bwa-actions {
  display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px;
  padding: 12px 16px 16px; border-top: 1px solid #e6eaec;
}
.bwa-button {
  appearance: none; border: 1px solid transparent; border-radius: 9px;
  padding: 10px 18px; font-size: 15px; font-weight: 600; line-height: 1.2;
  cursor: pointer; background: #1f6feb; color: #ffffff; min-width: 88px;
}
.bwa-button:hover { filter: brightness(1.06); }
.bwa-button:focus-visible { outline: 3px solid #0b3d91; outline-offset: 2px; }
.bwa-button[data-alert-style="cancel"] { background: #eef1f3; color: #11181c; border-color: #d3d9dd; margin-right: auto; }
.bwa-button[data-alert-style="destructive"] { background: #c02b2b; color: #ffffff; }
`;

/** Alerts waiting behind the one on screen. Native serializes them; so do we. */
const queue = [];
/**
 * The dialog currently on screen as `{ backdrop, dispose }`, or null.
 *
 * `dispose` detaches the document-level key handler, so a dialog that is torn down by
 * something other than its own buttons does not leave a listener behind.
 */
let open = null;
let seq = 0;

function log(entry) {
  const w = globalThis.window;
  if (!w) return;
  if (!Array.isArray(w.__BOUNTY_ALERTS__)) w.__BOUNTY_ALERTS__ = [];
  w.__BOUNTY_ALERTS__.push(entry);
  const overflow = w.__BOUNTY_ALERTS__.length - LOG_LIMIT;
  if (overflow > 0) w.__BOUNTY_ALERTS__.splice(0, overflow);
}

function ensureStyles(doc) {
  if (doc.getElementById(STYLE_ELEMENT_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ELEMENT_ID;
  style.textContent = CSS;
  doc.head.appendChild(style);
}

/**
 * Normalize the `buttons` argument the way native does: no buttons at all means a
 * single dismissing "OK".
 */
function normalizeButtons(buttons) {
  const list = Array.isArray(buttons) && buttons.length > 0 ? buttons : [{ text: 'OK' }];
  return list.map((b, i) => ({
    text: typeof b?.text === 'string' && b.text.length > 0 ? b.text : 'OK',
    style: b?.style === 'cancel' || b?.style === 'destructive' ? b.style : 'default',
    onPress: typeof b?.onPress === 'function' ? b.onPress : null,
    index: i,
  }));
}

function render(request) {
  const doc = globalThis.document;
  ensureStyles(doc);

  const id = 'bwa-' + ++seq;
  const buttons = normalizeButtons(request.buttons);
  const cancelable = request.options?.cancelable !== false;
  const cancelButton = buttons.find((b) => b.style === 'cancel') ?? null;

  const backdrop = doc.createElement('div');
  backdrop.className = 'bwa-backdrop';
  backdrop.setAttribute('data-testid', 'rnw-alert-backdrop');

  const dialog = doc.createElement('div');
  dialog.className = 'bwa-dialog';
  dialog.setAttribute('role', 'alertdialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('data-testid', 'rnw-alert');
  dialog.setAttribute('data-alert-title', request.title);
  dialog.setAttribute('aria-labelledby', id + '-title');

  const body = doc.createElement('div');
  body.className = 'bwa-body';

  const title = doc.createElement('h2');
  title.className = 'bwa-title';
  title.id = id + '-title';
  title.textContent = request.title;
  body.appendChild(title);

  const message = doc.createElement('p');
  message.className = 'bwa-message';
  message.id = id + '-message';
  message.textContent = request.message;
  body.appendChild(message);
  if (request.message) dialog.setAttribute('aria-describedby', id + '-message');

  const actions = doc.createElement('div');
  actions.className = 'bwa-actions';

  dialog.appendChild(body);
  dialog.appendChild(actions);
  backdrop.appendChild(dialog);

  // Restore focus to whatever the user was on, as a real modal must.
  const previouslyFocused = doc.activeElement;

  let settled = false;
  /**
   * Close the dialog and run the chosen button's handler.
   *
   * The handler runs AFTER the dialog is torn down, and `pump()` runs after the
   * handler, because `onPress` handlers in this app routinely raise another alert
   * ("Payment failed" -> "Try again?"). Running the handler first lets that new alert
   * take the free slot immediately, in the order native would show them.
   */
  function settle(button, via) {
    if (settled) return;
    settled = true;
    dispose();
    backdrop.remove();
    open = null;
    log({
      ts: Date.now(),
      title: request.title,
      message: request.message,
      buttons: buttons.map((b) => b.text),
      dismissedWith: button ? button.text : null,
      via,
    });
    if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
      try {
        previouslyFocused.focus();
      } catch {
        /* the node may be gone; never let focus restoration break the app */
      }
    }
    try {
      if (button?.onPress) button.onPress();
      if (via !== 'button' && typeof request.options?.onDismiss === 'function') {
        request.options.onDismiss();
      }
    } finally {
      pump();
    }
  }

  /** Detach anything this dialog installed outside its own subtree. */
  function dispose() {
    doc.removeEventListener('keydown', onKeyDown, true);
  }

  function onKeyDown(event) {
    if (event.key !== 'Escape' || !cancelable) return;
    event.preventDefault();
    event.stopPropagation();
    settle(cancelButton, 'escape');
  }

  // Cancel first (left, per the stylesheet's margin-right:auto), then the rest in the
  // order the caller gave them -- matching how the native dialogs read.
  const ordered = [
    ...buttons.filter((b) => b.style === 'cancel'),
    ...buttons.filter((b) => b.style !== 'cancel'),
  ];
  for (const button of ordered) {
    const el = doc.createElement('button');
    el.type = 'button';
    el.className = 'bwa-button';
    el.textContent = button.text;
    el.setAttribute('data-alert-style', button.style);
    el.addEventListener('click', () => settle(button, 'button'));
    actions.appendChild(el);
  }

  if (cancelable) {
    backdrop.addEventListener('click', (event) => {
      if (event.target !== backdrop) return; // only the backdrop itself, not the card
      settle(cancelButton, 'backdrop');
    });
  }
  doc.addEventListener('keydown', onKeyDown, true);

  doc.body.appendChild(backdrop);
  open = { backdrop, dispose };

  // Land focus on the affirmative action, so keyboard-only and screen-reader agents
  // arrive inside the dialog rather than behind it.
  const affirmative = actions.querySelector('.bwa-button:not([data-alert-style="cancel"])');
  const toFocus = affirmative ?? actions.querySelector('.bwa-button');
  if (toFocus && typeof toFocus.focus === 'function') toFocus.focus();
}

/**
 * Show the next queued alert, if nothing is on screen.
 *
 * A dialog can leave the DOM without going through `settle` -- a route change or any
 * other code that replaces document.body detaches it. If we trusted `open` blindly,
 * every subsequent alert would queue behind a dialog nobody can see or dismiss, which
 * is the exact silent-swallow this module exists to remove. So a detached dialog is
 * treated as closed.
 */
function pump() {
  if (open && !open.backdrop.isConnected) {
    open.dispose();
    open = null;
  }
  if (open || queue.length === 0) return;
  render(queue.shift());
}

class Alert {
  /**
   * @param {string} [title]
   * @param {string} [message]
   * @param {Array<{text?: string, onPress?: Function, style?: 'default'|'cancel'|'destructive'}>} [buttons]
   * @param {{cancelable?: boolean, onDismiss?: Function}} [options]
   */
  static alert(title, message, buttons, options) {
    const request = {
      title: title == null ? '' : String(title),
      message: message == null ? '' : String(message),
      buttons,
      options,
    };
    // No DOM: the static-export prerender pass, or a non-browser test environment.
    // Still record it, so a caller under test can assert the app tried to speak.
    const doc = globalThis.document;
    if (!doc || !doc.body) {
      log({
        ts: Date.now(),
        title: request.title,
        message: request.message,
        buttons: null,
        dismissedWith: null,
        via: 'no-dom',
      });
      return;
    }
    queue.push(request);
    pump();
  }
}

/** Lets the QA guard assert the served bundle carries this shim and not the upstream no-op. */
Alert.__bountyWebAlertShim = true;

module.exports = Alert;
module.exports.default = Alert;
Object.defineProperty(module.exports, '__esModule', { value: true });
