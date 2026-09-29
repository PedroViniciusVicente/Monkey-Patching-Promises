'use strict';

/**
 * promise-tracker.js
 *
 * Loaded via `node --require promise-tracker.js` BEFORE the test framework
 * (Mocha/Jest/etc.) starts. It replaces the global `Promise` with a Proxy
 * that records, for every promise created afterwards:
 *   - a sequential id and creation/settlement timestamps
 *   - the async_hooks identifiers (asyncId / triggerAsyncId / executionAsyncId)
 *   - the file/line/column of the code that invoked `new Promise(...)`
 *   - how it settled (resolved/rejected), its value, and how long it took
 *
 * Every event is appended as one JSON line (NDJSON) to the log file, so
 * nothing is lost even if the test process crashes.
 *
 * Two kinds of promise are recorded, distinguished by `origin`:
 *   - "constructor": created via `new Promise(...)`, `.then/catch/finally`,
 *     or `Promise.resolve/reject/all/race/any/allSettled`. Fully tracked:
 *     creation, settlement, value, and duration.
 *   - "async-function": the single promise implicitly returned when an
 *     `async function` is called. The engine creates this via the realm's
 *     original intrinsic constructor, bypassing our Proxy entirely, so we
 *     can only see it through async_hooks. Its creation (id, call site,
 *     async_hooks ids) is logged, but its settlement is deliberately NOT
 *     observed: attaching a `.then()`/`.catch()` to it just to watch it
 *     settle would mark it "handled" in Node's internal bookkeeping and
 *     could suppress a genuine unhandledRejection for it. (Any promise
 *     explicitly constructed inside that async function is still tracked
 *     normally, with origin "constructor".)
 */

const fs = require('fs');
const path = require('path');
const asyncHooks = require('async_hooks');

// ---------------------------------------------------------------------------
// Configuration (set by cli.js, with sane fallbacks for standalone use)
// ---------------------------------------------------------------------------

const LOG_FILE = path.resolve(
  process.env.PROMISE_TRACKER_LOG_FILE || 'promise-trace.ndjson'
);
const SUMMARY_FILE = LOG_FILE.replace(/\.ndjson$/i, '') + '.summary.json';
const MAX_VALUE_LENGTH = 1000;

fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
fs.writeFileSync(LOG_FILE, '');

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let sequence = 0;
const liveRecords = new Map(); // asyncId -> record
const recordByPromise = new WeakMap(); // promise instance -> record
const pendingStack = []; // bridges the construct() trap and the init hook

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nowIso() {
  return new Date().toISOString();
}

/** Best-effort String(value) that can never itself throw (some objects have
 *  a Symbol.toPrimitive/toString that intentionally throws). */
function safeToString(value) {
  try {
    return String(value);
  } catch {
    return `<unstringifiable ${typeof value}>`;
  }
}

/** Turns a resolve/reject value into something safe and bounded to log as JSON.
 *  This must never throw: it runs inside the resolve/reject path of every
 *  tracked promise, so a failure here must not be allowed to affect the
 *  actual settlement of the real promise. */
function serializeValue(value) {
  try {
    if (value instanceof Error) {
      return { type: 'Error', name: value.name, message: value.message, stack: value.stack };
    }
    const json = JSON.stringify(value);
    if (json === undefined) return { type: typeof value, preview: safeToString(value) };
    return json.length > MAX_VALUE_LENGTH
      ? { type: typeof value, preview: json.slice(0, MAX_VALUE_LENGTH) + '…(truncated)' }
      : JSON.parse(json);
  } catch {
    return { type: typeof value, preview: safeToString(value).slice(0, MAX_VALUE_LENGTH) };
  }
}

/** Finds the first stack frame outside this file and Node internals. */
function captureCallSite() {
  const originalPrepare = Error.prepareStackTrace;
  Error.prepareStackTrace = (_err, stack) => stack;
  const holder = {};
  Error.captureStackTrace(holder, captureCallSite);
  const frames = holder.stack;
  Error.prepareStackTrace = originalPrepare;

  for (const frame of frames) {
    const file = frame.getFileName() || '';
    if (file === __filename || file.startsWith('node:')) continue;
    return {
      file,
      line: frame.getLineNumber(),
      column: frame.getColumnNumber(),
      function: frame.getFunctionName() || '<anonymous>',
    };
  }
  return null;
}

function appendLog(record) {
  try {
    fs.appendFileSync(LOG_FILE, JSON.stringify(record) + '\n');
  } catch (err) {
    // Never let logging failures break the test run.
    process.stderr.write(`[promise-tracker] failed to write log: ${err.message}\n`);
  }
}

function toLogLine(event, record) {
  return {
    event,
    id: record.id,
    origin: record.origin,
    asyncId: record.asyncId,
    triggerAsyncId: record.triggerAsyncId,
    executionAsyncId: record.executionAsyncId,
    status: record.status,
    createdAt: record.createdAt,
    settledAt: record.settledAt,
    durationMs: record.durationMs,
    callSite: record.callSite,
    value: record.value,
  };
}

// ---------------------------------------------------------------------------
// async_hooks: correlates each tracked promise with its async_hook identifiers
// ---------------------------------------------------------------------------

const hook = asyncHooks.createHook({
  init(asyncId, type, triggerAsyncId, resource) {
    // async_hooks callbacks that throw crash the whole process, so every
    // path here is guarded - tracking must never be able to do that.
    try {
      if (type !== 'PROMISE') return;

      // The record for a promise created via our Proxy (new Promise(...),
      // .then/catch/finally, Promise.resolve/reject/all/...) sits on top of
      // the stack, pushed synchronously just before Reflect.construct.
      let record = pendingStack.pop();
      const implicit = !record;

      if (implicit) {
        // No matching record: this promise was created without going
        // through our Proxy at all - in practice, almost always the promise
        // an `async function` call implicitly returns (created by the
        // engine via the original intrinsic Promise, see file header).
        // We log its creation but never attach .then()/.catch() to it -
        // see the file header for why. Its status is "unknown" (not
        // "pending") because we have no way to tell if/when it settles -
        // marking it "pending" would make every async function call look
        // like a leaked promise in the exit summary.
        record = {
          id: ++sequence,
          origin: 'async-function',
          status: 'unknown',
          callSite: captureCallSite(),
          createdAt: nowIso(),
          settledAt: null,
          durationMs: null,
          value: null,
          asyncId: null,
          triggerAsyncId: null,
          executionAsyncId: null,
        };
      } else {
        record.origin = 'constructor';
      }

      record.asyncId = asyncId;
      record.triggerAsyncId = triggerAsyncId;
      record.executionAsyncId = asyncHooks.executionAsyncId();

      recordByPromise.set(resource, record);
      liveRecords.set(asyncId, record);
      appendLog(toLogLine('create', record));
    } catch {
      // best effort only
    }
  },

  destroy(asyncId) {
    try {
      const record = liveRecords.get(asyncId);
      if (record && record.status === 'pending') {
        record.status = 'destroyed';
        appendLog(toLogLine('destroy', record));
      }
      liveRecords.delete(asyncId);
    } catch {
      // best effort only
    }
  },
});
hook.enable();

// ---------------------------------------------------------------------------
// Promise patch: Proxy + Reflect around the global constructor
// ---------------------------------------------------------------------------

const OriginalPromise = global.Promise;

const PatchedPromise = new Proxy(OriginalPromise, {
  construct(target, args, newTarget) {
    // Tracking is best-effort: if anything below throws unexpectedly, fall
    // back to plain, unmodified promise construction rather than breaking
    // the program being tested.
    let record;
    try {
      record = {
        id: ++sequence,
        status: 'pending',
        callSite: captureCallSite(),
        createdAt: nowIso(),
        settledAt: null,
        durationMs: null,
        value: null,
        asyncId: null,
        triggerAsyncId: null,
        executionAsyncId: null,
      };
    } catch {
      return Reflect.construct(target, args, newTarget);
    }

    const [executor] = args;
    const createdAt = process.hrtime.bigint();

    // IMPORTANT: this only ever records metadata. It must never throw and
    // must never delay or prevent the real resolve/reject from being called,
    // or it would break the actual behavior of the program being tested.
    function recordSettlement(status, value) {
      try {
        if (record.status !== 'pending') return; // already settled, ignore
        record.status = status;
        record.settledAt = nowIso();
        record.durationMs = Number(process.hrtime.bigint() - createdAt) / 1e6;
        record.value = serializeValue(value);
        appendLog(toLogLine(status, record));
      } catch {
        // Tracking must be best-effort only; swallow any unexpected error.
      }
    }

    let wrappedExecutor = executor;
    if (typeof executor === 'function') {
      wrappedExecutor = function (resolve, reject) {
        return executor(
          (value) => { resolve(value); recordSettlement('resolved', value); },
          (reason) => { reject(reason); recordSettlement('rejected', reason); }
        );
      };
    }

    // Pushed right before creation so the init hook (fired synchronously
    // inside Reflect.construct, before the executor runs) can pick it up.
    pendingStack.push(record);
    const instance = Reflect.construct(target, [wrappedExecutor], newTarget);
    // Safety net: if async_hooks didn't fire (e.g. hooks disabled), don't
    // leave a stale record for the next promise to pick up by mistake.
    const idx = pendingStack.indexOf(record);
    if (idx !== -1) pendingStack.splice(idx, 1);

    recordByPromise.set(instance, record);
    return instance;
  },

  get(target, prop, receiver) {
    return Reflect.get(target, prop, receiver);
  },
});

global.Promise = PatchedPromise;

// ---------------------------------------------------------------------------
// Extra diagnostics: unhandled rejections, referencing the tracked record
// ---------------------------------------------------------------------------

process.on('unhandledRejection', (reason, promise) => {
  const record = recordByPromise.get(promise);
  appendLog({
    event: 'unhandledRejection',
    id: record ? record.id : null,
    asyncId: record ? record.asyncId : null,
    callSite: record ? record.callSite : null,
    reason: serializeValue(reason),
    at: nowIso(),
  });
});

// ---------------------------------------------------------------------------
// Summary written once the test process exits
// ---------------------------------------------------------------------------

process.on('exit', () => {
  const all = [...liveRecords.values()];
  const stillPending = all.filter((r) => r.status === 'pending'); // origin: constructor only
  const asyncFunctionPromises = all.filter((r) => r.origin === 'async-function');
  const summary = {
    totalCreated: sequence,
    // Only "constructor" origin promises can be flagged as leaked here -
    // "async-function" origin promises are never marked pending (see
    // file header), so they're reported separately, not as leaks.
    stillPendingAtExit: stillPending.length,
    pendingCallSites: stillPending.map((r) => r.callSite).filter(Boolean),
    asyncFunctionCallsObserved: asyncFunctionPromises.length,
    logFile: LOG_FILE,
    generatedAt: nowIso(),
  };
  try {
    fs.writeFileSync(SUMMARY_FILE, JSON.stringify(summary, null, 2));
  } catch {
    // best effort
  }
});

module.exports = { LOG_FILE, SUMMARY_FILE };