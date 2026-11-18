// Local D1 is one SQLite file. Overlapping statements return SQLITE_BUSY, and
// wrangler can turn that into a 500 or kill the process. One isolate-wide
// queue makes contention impossible; stale writes then see 0 changes / 409.
const originals = new WeakMap();
const serialised = new WeakMap();
let chain = Promise.resolve();
function enqueue(op) {
    const run = chain.then(op, op);
    chain = run.then(() => undefined, () => undefined);
    return run;
}
function wrapStatement(stmt) {
    const wrapped = new Proxy(stmt, {
        get(target, prop, receiver) {
            if (prop === "bind") {
                return (...args) => wrapStatement(target.bind(...args));
            }
            const value = Reflect.get(target, prop, receiver);
            if (typeof value === "function" &&
                (prop === "first" || prop === "run" || prop === "all" || prop === "raw")) {
                return (...args) => enqueue(() => value.apply(target, args));
            }
            return typeof value === "function"
                ? value.bind(target)
                : value;
        },
    });
    originals.set(wrapped, stmt);
    return wrapped;
}
function install(target, key, value) {
    try {
        target[key] = value;
        if (target[key] === value)
            return true;
    }
    catch {
        /* host objects reject assignment */
    }
    try {
        Object.defineProperty(target, key, {
            value,
            writable: true,
            configurable: true,
            enumerable: true,
        });
        return target[key] === value;
    }
    catch {
        return false;
    }
}
export function serialiseD1(db) {
    const existing = serialised.get(db);
    if (existing)
        return existing;
    const prepare = db.prepare.bind(db);
    const batch = db.batch.bind(db);
    const exec = typeof db.exec === "function" ? db.exec.bind(db) : undefined;
    const wrappedPrepare = ((query) => wrapStatement(prepare(query)));
    const wrappedBatch = ((statements) => enqueue(() => batch(statements.map((statement) => originals.get(statement) ?? statement))));
    const wrappedExec = exec
        ? ((query) => enqueue(() => exec(query)))
        : undefined;
    install(db, "prepare", wrappedPrepare);
    install(db, "batch", wrappedBatch);
    if (wrappedExec)
        install(db, "exec", wrappedExec);
    if (db.prepare === wrappedPrepare) {
        serialised.set(db, db);
        return db;
    }
    const proxy = new Proxy(db, {
        get(target, prop, receiver) {
            if (prop === "prepare")
                return wrappedPrepare;
            if (prop === "batch")
                return wrappedBatch;
            if (prop === "exec" && wrappedExec)
                return wrappedExec;
            const value = Reflect.get(target, prop, receiver);
            return typeof value === "function"
                ? value.bind(target)
                : value;
        },
    });
    serialised.set(db, proxy);
    serialised.set(proxy, proxy);
    return proxy;
}
let adminTurn = Promise.resolve();
export async function withSerialisedAdmin(op) {
    let release;
    const previous = adminTurn;
    adminTurn = new Promise((resolve) => {
        release = resolve;
    });
    await previous;
    try {
        return await op();
    }
    finally {
        release();
    }
}
function replaceBinding(env, key, db) {
    if (!db)
        return;
    install(env, key, serialiseD1(db));
}
export function serialiseBindings(env) {
    replaceBinding(env, "CMS_DB", env.CMS_DB);
    replaceBinding(env, "AUTH_DB", env.AUTH_DB);
    replaceBinding(env, "WIP_DB", env.WIP_DB);
    return env;
}
