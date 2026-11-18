// Local D1 is one SQLite file. Overlapping statements return SQLITE_BUSY, and
// wrangler can turn that into a 500 or kill the process. One isolate-wide
// queue makes contention impossible; stale writes then see 0 changes / 409.

const originals = new WeakMap<D1PreparedStatement, D1PreparedStatement>();
const serialised = new WeakMap<object, D1Database>();
let chain = Promise.resolve();

function enqueue<T>(op: () => Promise<T>): Promise<T> {
  const run = chain.then(op, op);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function wrapStatement(stmt: D1PreparedStatement): D1PreparedStatement {
  const wrapped = new Proxy(stmt, {
    get(target, prop, receiver) {
      if (prop === "bind") {
        return (...args: unknown[]) => wrapStatement(target.bind(...args));
      }
      const value = Reflect.get(target, prop, receiver);
      if (
        typeof value === "function" &&
        (prop === "first" || prop === "run" || prop === "all" || prop === "raw")
      ) {
        return (...args: unknown[]) =>
          enqueue(() =>
            (value as (...values: unknown[]) => Promise<unknown>).apply(
              target,
              args,
            ),
          );
      }
      return typeof value === "function"
        ? (value as (...values: unknown[]) => unknown).bind(target)
        : value;
    },
  });
  originals.set(wrapped, stmt);
  return wrapped;
}

function install(target: object, key: string, value: unknown) {
  try {
    (target as Record<string, unknown>)[key] = value;
    if ((target as Record<string, unknown>)[key] === value) return true;
  } catch {
    /* host objects reject assignment */
  }
  try {
    Object.defineProperty(target, key, {
      value,
      writable: true,
      configurable: true,
      enumerable: true,
    });
    return (target as Record<string, unknown>)[key] === value;
  } catch {
    return false;
  }
}

export function serialiseD1(db: D1Database): D1Database {
  const existing = serialised.get(db);
  if (existing) return existing;
  const prepare = db.prepare.bind(db);
  const batch = db.batch.bind(db);
  const exec = typeof db.exec === "function" ? db.exec.bind(db) : undefined;
  const wrappedPrepare = ((query: string) =>
    wrapStatement(prepare(query))) as D1Database["prepare"];
  const wrappedBatch = ((statements: D1PreparedStatement[]) =>
    enqueue(() =>
      batch(
        statements.map((statement) => originals.get(statement) ?? statement),
      ),
    )) as D1Database["batch"];
  const wrappedExec = exec
    ? (((query: string) => enqueue(() => exec(query))) as D1Database["exec"])
    : undefined;
  install(db, "prepare", wrappedPrepare);
  install(db, "batch", wrappedBatch);
  if (wrappedExec) install(db, "exec", wrappedExec);
  if (db.prepare === wrappedPrepare) {
    serialised.set(db, db);
    return db;
  }
  const proxy = new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === "prepare") return wrappedPrepare;
      if (prop === "batch") return wrappedBatch;
      if (prop === "exec" && wrappedExec) return wrappedExec;
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function"
        ? (value as (...values: unknown[]) => unknown).bind(target)
        : value;
    },
  });
  serialised.set(db, proxy);
  serialised.set(proxy, proxy);
  return proxy;
}

let adminTurn = Promise.resolve();

export async function withSerialisedAdmin<T>(op: () => Promise<T>): Promise<T> {
  let release!: () => void;
  const previous = adminTurn;
  adminTurn = new Promise((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await op();
  } finally {
    release();
  }
}

function replaceBinding<T extends object>(
  env: T,
  key: keyof T & string,
  db: D1Database | undefined,
) {
  if (!db) return;
  install(env, key, serialiseD1(db));
}

export function serialiseBindings<
  T extends { CMS_DB: D1Database; AUTH_DB?: D1Database; WIP_DB?: D1Database },
>(env: T): T {
  replaceBinding(env, "CMS_DB", env.CMS_DB);
  replaceBinding(env, "AUTH_DB", env.AUTH_DB);
  replaceBinding(env, "WIP_DB", env.WIP_DB);
  return env;
}
