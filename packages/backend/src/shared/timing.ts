import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Step timings for finding slow steps (diagnostics only, off unless LOG_TIMINGS=1). Steps started inside another step
 * are collected into its tree; the tree is printed once, when the outermost step ends, so concurrent requests do not mix.
 */
const ON = process.env.LOG_TIMINGS === '1';

interface Entry {
  label: string;
  depth: number;
  ms?: number;
  info?: string;
}
interface Scope {
  depth: number;
  entries: Entry[];
}

const als = new AsyncLocalStorage<Scope>();

function begin(label: string): { scope: Scope; entry: Entry; root: boolean; t0: number } {
  const parent = als.getStore();
  const entry: Entry = { label, depth: parent ? parent.depth + 1 : 0 };
  const scope: Scope = { depth: entry.depth, entries: parent?.entries ?? [] };
  scope.entries.push(entry);
  return { scope, entry, root: !parent, t0: performance.now() };
}

function finish(s: ReturnType<typeof begin>, info?: string) {
  s.entry.ms = performance.now() - s.t0;
  s.entry.info = info;
  if (!s.root) return;
  const lines = s.scope.entries.map(
    (e) =>
      `${'  '.repeat(e.depth)}${e.label}: ` +
      (e.ms === undefined ? (e.info ?? '') : `${e.ms.toFixed(1)} ms${e.info ? ` (${e.info})` : ''}`),
  );
  console.log(`[timing]\n${lines.join('\n')}`);
}

/** Runs an async step and records how long it took; `info` describes the result (row counts and the like). */
export async function timed<T>(label: string, fn: () => Promise<T>, info?: (r: T) => string): Promise<T> {
  if (!ON) return fn();
  const s = begin(label);
  let result: T | undefined;
  try {
    result = await als.run(s.scope, fn);
    return result;
  } finally {
    finish(s, result !== undefined && info ? info(result) : undefined);
  }
}

/** The same for a synchronous step. */
export function timedSync<T>(label: string, fn: () => T, info?: (r: T) => string): T {
  if (!ON) return fn();
  const s = begin(label);
  let result: T | undefined;
  try {
    result = als.run(s.scope, fn);
    return result;
  } finally {
    finish(s, result !== undefined && info ? info(result) : undefined);
  }
}

/** Records a step measured elsewhere (e.g. the server-side time ClickHouse reports) inside the current step. */
export function note(label: string, info: string) {
  if (!ON) return;
  const parent = als.getStore();
  if (parent) parent.entries.push({ label, depth: parent.depth + 1, info });
}

/** A synchronous step measured from this call to the returned function's call (for a loop that is awkward to wrap). */
export function timedStep(label: string): (info?: string) => void {
  if (!ON) return () => {};
  const s = begin(label);
  return (info) => finish(s, info);
}
