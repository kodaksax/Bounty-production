/**
 * Minimal EventEmitter — drop-in replacement for the subset of the Node
 * `events` API used by our messaging/cache services.
 *
 * Why not `import { EventEmitter } from 'events'`?
 * The `events` npm package is a Browserify polyfill of Node's built-in. On
 * some Hermes/Android dev-client configurations it fails to resolve at
 * runtime (manifesting as `Cannot read property 'EventEmitter' of undefined`
 * during early bundle evaluation). Using a tiny local class removes the
 * resolver dependency entirely and behaves identically on iOS and Android.
 *
 * Supported API: on, off, emit, setMaxListeners (no-op), removeAllListeners.
 */

export type EventHandler = (...args: any[]) => void;

export class EventEmitter {
  private handlers: Map<string, Set<EventHandler>> = new Map();

  on(event: string, handler: EventHandler): this {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler);
    return this;
  }

  addListener(event: string, handler: EventHandler): this {
    return this.on(event, handler);
  }

  off(event: string, handler: EventHandler): this {
    const set = this.handlers.get(event);
    if (set) {
      set.delete(handler);
      if (set.size === 0) this.handlers.delete(event);
    }
    return this;
  }

  removeListener(event: string, handler: EventHandler): this {
    return this.off(event, handler);
  }

  emit(event: string, ...args: any[]): boolean {
    const set = this.handlers.get(event);
    if (!set || set.size === 0) return false;
    // Snapshot to allow handlers to mutate listener set safely
    const snapshot = Array.from(set);
    for (const h of snapshot) {
      try {
        h(...args);
      } catch (err) {
        // Don't let one bad listener break the others
        // eslint-disable-next-line no-console
        if (typeof __DEV__ !== 'undefined' && __DEV__)
          console.warn(`EventEmitter handler error for event '${event}':`, err);
      }
    }
    return true;
  }

  removeAllListeners(event?: string): this {
    if (event) this.handlers.delete(event);
    else this.handlers.clear();
    return this;
  }

  // No-op for API compatibility with Node's EventEmitter; we don't enforce a cap.
  setMaxListeners(_n: number): this {
    return this;
  }

  listenerCount(event: string): number {
    return this.handlers.get(event)?.size ?? 0;
  }
}

export default EventEmitter;
