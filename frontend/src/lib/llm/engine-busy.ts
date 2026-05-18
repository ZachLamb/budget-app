/**
 * Serializes web-llm inference — one generate() at a time per tab.
 */

let locked = false;
const waiters: (() => void)[] = [];

async function acquire(): Promise<void> {
  while (locked) {
    await new Promise<void>((resolve) => {
      waiters.push(resolve);
    });
  }
  locked = true;
}

function release(): void {
  locked = false;
  const next = waiters.shift();
  next?.();
}

/** Wrap an async generator so the lock is held for the full iteration. */
export async function* withEngineLockGenerator<T>(
  fn: () => AsyncGenerator<T>,
): AsyncGenerator<T> {
  await acquire();
  try {
    yield* fn();
  } finally {
    release();
  }
}
