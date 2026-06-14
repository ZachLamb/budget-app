let chain: Promise<unknown> = Promise.resolve();

/**
 * Run `fn` with a Nano slot. v1 caps concurrency at 1 (sequential), because the
 * Chrome Prompt API engine is effectively serialized on-device. Phase 3 raises
 * the cap and adds `clone()`-based session pooling.
 */
export function withNanoSlot<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
