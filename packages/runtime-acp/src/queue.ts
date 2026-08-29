/**
 * A one-consumer async queue. Events are produced by the ACP handlers and the
 * transcript tail, both of which run whether or not anyone is reading, so they
 * are buffered from the moment the run starts: a consumer that attaches late
 * still sees the whole run from its first event.
 */
export class EventQueue<T> implements AsyncIterable<T> {
  /** Boxed so an empty queue is distinguishable from a queued `undefined`. */
  readonly #buffer: { readonly value: T }[] = [];
  #waiting: ((result: IteratorResult<T>) => void) | undefined;
  #closed = false;

  push(value: T): void {
    if (this.#closed) return;
    const waiting = this.#waiting;
    if (waiting !== undefined) {
      this.#waiting = undefined;
      waiting({ done: false, value });
      return;
    }
    this.#buffer.push({ value });
  }

  /** Ends the iteration once what is already buffered has been read. */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    const waiting = this.#waiting;
    if (waiting !== undefined) {
      this.#waiting = undefined;
      waiting({ done: true, value: undefined });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        const head = this.#buffer.shift();
        if (head !== undefined) return Promise.resolve({ done: false, value: head.value });
        if (this.#closed) return Promise.resolve({ done: true, value: undefined });
        return new Promise<IteratorResult<T>>((resolve) => {
          this.#waiting = resolve;
        });
      },
    };
  }
}
