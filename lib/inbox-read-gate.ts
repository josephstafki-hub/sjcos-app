/** Per-mailbox concurrency gate for on-demand Gmail reads.
 *  Server Actions used to serialize these by accident; a GET route runs them in
 *  parallel, and fast thread switching then bursts Joe's per-minute Gmail quota
 *  (shared with the live site's cron jobs). Two in flight per key, the rest queue. */
const active = new Map<string, number>();
const waiting = new Map<string, Array<() => void>>();

export async function withReadGate<T>(key: string, fn: () => Promise<T>, limit = 2): Promise<T> {
  while ((active.get(key) ?? 0) >= limit) {
    await new Promise<void>(resolve => {
      const queue = waiting.get(key) ?? [];
      queue.push(resolve);
      waiting.set(key, queue);
    });
  }
  active.set(key, (active.get(key) ?? 0) + 1);
  try {
    return await fn();
  } finally {
    const left = (active.get(key) ?? 1) - 1;
    if (left > 0) active.set(key, left); else active.delete(key);
    const queue = waiting.get(key);
    const next = queue?.shift();
    if (queue && !queue.length) waiting.delete(key);
    next?.();
  }
}
