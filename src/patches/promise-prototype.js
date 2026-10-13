'use strict';

/**
 * patches/promise-prototype.js
 *
 * Patched object: `Promise.prototype` (`then`, `finally` and `constructor`).
 *
 * This is where the tracer understands promise chaining and `await`:
 *
 *  - `then` (and, as a consequence, `catch`): creates a "derived" record whose
 *    triggerAsyncId is the parent promise, and runs the callback in its context.
 *
 *  - `await`: V8 does NOT call `then` for an `await` of a native promise (it
 *    uses an optimized internal path), so there is nowhere to intercept the
 *    continuation. To make `await` observable we replace
 *    `Promise.prototype.constructor` with a getter. During `await`, the spec
 *    reads `promise.constructor`; if the value differs from the intrinsic
 *    `Promise`, the engine treats the promise as a "thenable" and calls our
 *    `then` in a microtask job. That tells us (1) in which context the `await`
 *    was written and (2) when the continuation will run. See
 *    `context.scheduleAwaitContext`.
 *
 *    Cost: an `await` takes 3 microtask ticks instead of 1 (the behavior of
 *    Node <= 10). Turn it off with PROMISE_TRACER_TRACK_AWAIT=0.
 */

const { RealPromise, originalThen, originalFinally, isNativePromise } = require('../core/intrinsics');
const context = require('../core/context');
const recorder = require('../core/recorder');
const { captureCallSite, isNodeBuiltinFile, isSyncFrame } = require('../core/callsite');

// Contexts of `await`s not yet consumed, per awaited promise (FIFO).
const awaitEntries = new WeakMap();

function enqueueAwaitEntry(promise, entry) {
  const entries = awaitEntries.get(promise);
  if (entries) entries.push(entry);
  else awaitEntries.set(promise, [entry]);
}

function takeAwaitEntry(promise) {
  const entries = awaitEntries.get(promise);
  if (!entries || entries.length === 0) return undefined;
  const entry = entries.shift();
  if (entries.length === 0) awaitEntries.delete(promise);
  return entry;
}

/** The promise's record; if the promise was not known yet (e.g. an async function's return value), creates an "observed" one. */
function recordForPromise(promise, callSite, triggerAsyncId = context.currentAsyncId()) {
  let record = recorder.recordOf(promise);
  if (!record) {
    record = recorder.begin({ type: 'Promise', origin: 'observed', triggerAsyncId, callSite });
    recorder.track(promise, record);
  }
  return record;
}

/** The parent promise has just settled (we know because one of its reactions is running). */
function settleParent(record, branch, argument) {
  if (!record.isOpen) return;
  recorder.finalize(
    record,
    branch === 'rejected' ? { status: 'rejected', reason: argument, captureReason: true } : { status: 'fulfilled' },
  );
}

const passThrough = (promise, onFulfilled, onRejected) => context.callNative(originalThen, promise, [onFulfilled, onRejected]);

/** Reaction (one of the two branches of a `.then`) that runs the user's handler in the derived promise's context. */
function createReaction(branch, handler, parentRecord, derivedRecord) {
  return function tracedReaction(argument) {
    settleParent(parentRecord, branch, argument);
    derivedRecord.noteRun();

    if (typeof handler !== 'function') {
      // No handler on this branch: the derived promise just forwards the parent's outcome.
      if (branch === 'rejected') {
        recorder.finalize(derivedRecord, { status: 'rejected', reason: argument, captureReason: true });
        throw argument;
      }
      recorder.finalize(derivedRecord, { status: 'fulfilled' });
      return argument;
    }

    try {
      const result = context.runInContext(derivedRecord.asyncId, handler, undefined, [argument]);
      recorder.finalize(derivedRecord, { status: isNativePromise(result) ? 'adopted' : 'fulfilled' });
      return result;
    } catch (error) {
      recorder.finalize(derivedRecord, { status: 'rejected', reason: error, captureReason: true });
      throw error;
    }
  };
}

function reactToUserThen(promise, callSite, onFulfilled, onRejected) {
  const parentRecord = recordForPromise(promise, callSite);
  const derivedRecord = recorder.begin({
    type: 'Promise.then',
    origin: 'derived',
    triggerAsyncId: parentRecord.asyncId,
    callSite,
  });
  const derived = passThrough(
    promise,
    createReaction('fulfilled', onFulfilled, parentRecord, derivedRecord),
    createReaction('rejected', onRejected, parentRecord, derivedRecord),
  );
  recorder.track(derived, derivedRecord);
  return derived;
}

/**
 * `then` called by the engine for an `await` (a "thenable" job). The two
 * callbacks are the native resolve/reject functions of the `await`'s internal
 * promise. After calling one of them the `await` continuation is scheduled, and
 * we record in which context it will run.
 */
function reactToAwait(promise, entry, resolveAwait, rejectAwait) {
  const awaitedRecord = recordForPromise(promise, entry.callSite, entry.contextId);

  const continueWith = (branch, settleAwait) =>
    function tracedAwaitReaction(argument) {
      settleParent(awaitedRecord, branch, argument);
      awaitedRecord.noteRun();
      const result = typeof settleAwait === 'function' ? settleAwait(argument) : undefined;
      context.scheduleAwaitContext(awaitedRecord.asyncId);
      return result;
    };

  return passThrough(promise, continueWith('fulfilled', resolveAwait), continueWith('rejected', rejectAwait));
}

function traceThen(promise, onFulfilled, onRejected) {
  // The native `then` throws the TypeError for a non-promise receiver.
  if (!isNativePromise(promise)) return Reflect.apply(originalThen, promise, [onFulfilled, onRejected]);

  const awaitEntry = takeAwaitEntry(promise);
  if (awaitEntry) return reactToAwait(promise, awaitEntry, onFulfilled, onRejected);

  if (context.isTracingSuppressed()) return passThrough(promise, onFulfilled, onRejected);
  const callSite = captureCallSite();
  if (!callSite.userInitiated) return passThrough(promise, onFulfilled, onRejected);
  return reactToUserThen(promise, callSite, onFulfilled, onRejected);
}

/** Replaces `Promise.prototype.constructor` with a getter that sees the user's `await`s. */
function installAwaitProbe() {
  // It only needs to differ from the intrinsic Promise; [Symbol.species] makes sure
  // `then`/`finally` keep creating plain promises.
  class AwaitProbe extends RealPromise {
    static get [Symbol.species]() {
      return RealPromise;
    }
  }
  Object.defineProperty(AwaitProbe, 'name', { value: 'Promise', configurable: true });

  Object.defineProperty(RealPromise.prototype, 'constructor', {
    configurable: true,
    enumerable: false,
    get() {
      if (context.isSpeciesLookup() || !isNativePromise(this)) return RealPromise;
      const callSite = captureCallSite();
      // The innermost frame is where the `await` is written. If it is Node's own
      // code, keep the fast path (no tracing, no extra cost).
      const awaitSite = callSite.frames.find(isSyncFrame);
      if (!awaitSite || isNodeBuiltinFile(awaitSite.file)) return RealPromise;
      enqueueAwaitEntry(this, { contextId: context.currentAsyncId(), callSite });
      return AwaitProbe;
    },
    set(value) {
      Object.defineProperty(this, 'constructor', { value, writable: true, configurable: true, enumerable: false });
    },
  });
}

function install({ trackAwait = true } = {}) {
  // Proxies keep name/length/symbol properties of the originals without copying them by hand.
  RealPromise.prototype.then = new Proxy(originalThen, {
    apply(_target, thisArg, args) {
      return traceThen(thisArg, args[0], args[1]);
    },
  });

  // `finally` reads `this.constructor` (SpeciesConstructor) before calling our `then`.
  RealPromise.prototype.finally = new Proxy(originalFinally, {
    apply(_target, thisArg, args) {
      return context.withSpeciesLookup(originalFinally, thisArg, [args[0]]);
    },
  });

  if (trackAwait) installAwaitProbe();
}

module.exports = { name: 'Promise.prototype', install };
