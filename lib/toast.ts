/**
 * Non-blocking confirmations. Call `showToast` when the user only needs to
 * know something worked. Keep Alert for questions and for anything they must
 * read before continuing.
 *
 * Kept free of UI imports so any screen, service or test can call it; the
 * single AppToastHost (components/ui/app-toast.tsx) does the drawing.
 */
export type ToastTone = 'success' | 'error' | 'info';

export interface ToastOptions {
  message: string;
  tone?: ToastTone;
  /** Milliseconds on screen. Defaults to a length based on the message. */
  duration?: number;
}

type Listener = (toast: ToastOptions) => void;

let listener: Listener | null = null;
let pending: ToastOptions | null = null;

export function showToast(toast: ToastOptions) {
  if (listener) listener(toast);
  else pending = toast;
}

/** Host only. Delivers any toast raised before it mounted. */
export function subscribeToToasts(next: Listener): () => void {
  listener = next;
  if (pending) {
    next(pending);
    pending = null;
  }
  return () => {
    if (listener === next) listener = null;
  };
}
