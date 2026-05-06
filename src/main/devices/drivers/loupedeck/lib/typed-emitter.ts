import { EventEmitter } from 'node:events';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- listener params vary per event
type Listener = (...args: any[]) => void;

/**
 * Extract parameters from an event map value, falling back to `unknown[]`
 * when the value is not known to be a function (which it always will be in
 * practice — the loose `object` constraint is only needed so TypeScript
 * interfaces without an index-signature can be used as event maps).
 */
type EventArgs<T> = T extends Listener ? Parameters<T> : unknown[];

/**
 * A strongly-typed wrapper around Node's {@link EventEmitter}.
 *
 * Usage:
 * ```ts
 * interface MyEvents {
 *   data: (payload: Buffer) => void;
 *   error: (err: Error) => void;
 * }
 * class MyThing extends TypedEmitter<MyEvents> { ... }
 * ```
 *
 * All of `on`, `once`, `off`, `emit`, `addListener`, `removeListener`,
 * and `removeAllListeners` are type-safe.
 *
 * The constraint is kept intentionally loose (`object`) so that
 * TypeScript interfaces (which lack an implicit index signature)
 * can be used as event maps.  Type safety is enforced at each
 * method's call-site via `keyof Events`.
 */
export class TypedEmitter<Events extends object> extends EventEmitter {
  override on<E extends keyof Events & string>(event: E, listener: Events[E] & Listener): this {
    return super.on(event, listener);
  }

  override once<E extends keyof Events & string>(event: E, listener: Events[E] & Listener): this {
    return super.once(event, listener);
  }

  override off<E extends keyof Events & string>(event: E, listener: Events[E] & Listener): this {
    return super.off(event, listener);
  }

  override addListener<E extends keyof Events & string>(event: E, listener: Events[E] & Listener): this {
    return super.addListener(event, listener);
  }

  override removeListener<E extends keyof Events & string>(event: E, listener: Events[E] & Listener): this {
    return super.removeListener(event, listener);
  }

  override removeAllListeners<E extends keyof Events & string>(event?: E): this {
    if (event === undefined) return super.removeAllListeners();
    return super.removeAllListeners(event);
  }

  override emit<E extends keyof Events & string>(event: E, ...args: EventArgs<Events[E]>): boolean {
    return super.emit(event, ...args);
  }
}
