'use strict';

/**
 * primitives.js
 *
 * Small building blocks for writing patches (see `patches/`). This module
 * deliberately holds no interception policy: it does not decide WHICH
 * arguments are callbacks, WHAT gets traced beyond the call-site check, or
 * HOW a function is replaced. Each patch owns that logic (typically a
 * `Proxy` with an `apply` trap) and uses the primitives below for the
 * delicate, easy-to-get-wrong parts:
 *
 *  - beginTrace:   the "should I trace this call?" gate + record creation.
 *  - Trace:        handle for one traced call (wrap its callback, run the
 *                  original with the right suppression, fail on sync throw).
 *  - wrapCallback: run a callback inside the context of a record.
 *
 * Typical callback-style patch:
 *
 *   new Proxy(original, {
 *     apply(target, thisArg, args) {
 *       if (typeof args[0] !== 'function') return Reflect.apply(target, thisArg, args);
 *       const trace = beginTrace({ type: 'someApi', origin: 'callback-api' });
 *       if (!trace) return Reflect.apply(target, thisArg, args);
 *       args[0] = trace.wrapCallback(args[0]);
 *       return trace.run(target, thisArg, args);
 *     },
 *   });
 */

const context = require('./context');
const recorder = require('./recorder');
const { captureCallSite } = require('./callsite');

/** `accept` predicate: any synchronous frame outside Node internals (user code, Mocha, libraries...). */
const userInitiated = (callSite) => callSite.userInitiated;

/**
 * `accept` predicate: the innermost synchronous frame is user code. Use it for
 * APIs that Node itself calls all the time internally (timers, nextTick,
 * queueMicrotask).
 */
const directUserCall = (callSite) => callSite.directUserCall;

/** Short, safe summary of the "target" of an fs operation (path or fd). */
function describeTarget(value) {
  if (typeof value === 'string') return value.slice(0, 300);
  if (typeof value === 'number') return `fd:${value}`;
  if (Buffer.isBuffer(value)) return value.toString('utf8', 0, 300);
  if (value && typeof value === 'object') {
    if (typeof value.href === 'string') return value.href.slice(0, 300); // URL
    if (typeof value.fd === 'number') return `fd:${value.fd}`; // FileHandle
  }
  return null;
}

/** `{ target }` for fs records, or undefined when the first argument cannot be described. */
function targetDetails(args) {
  const target = describeTarget(args[0]);
  return target === null ? undefined : { target };
}

/**
 * Wraps `callback` so it runs in the context of `record`.
 * The record is closed when the callback STARTS (that is the moment the
 * operation has finished); `repeat: true` (setInterval) keeps the record open.
 * With `nodeStyleErrors`, an Error as first argument closes the record as rejected.
 */
function wrapCallback(callback, record, { repeat = false, nodeStyleErrors = false } = {}) {
  return new Proxy(callback, {
    apply(target, thisArg, args) {
      record.noteRun();
      if (!repeat) {
        const failed = nodeStyleErrors && args[0] instanceof Error;
        recorder.finalize(
          record,
          failed ? { status: 'rejected', reason: args[0], captureReason: true } : { status: 'fulfilled' },
        );
      }
      return context.runInContext(record.asyncId, target, thisArg, args);
    },
  });
}

/** Handle for one traced call. Created by `beginTrace`. */
class Trace {
  constructor(record, callSite) {
    this.record = record;
    this.callSite = callSite;
  }

  /** Wraps a callback argument so it runs in this trace's context (see `wrapCallback`). */
  wrapCallback(callback, options) {
    return wrapCallback(callback, this.record, options);
  }

  /** Associates an object (promise, Timeout, Immediate...) with this trace's record. */
  track(object) {
    recorder.track(object, this.record);
  }

  /** Closes the record as rejected. */
  fail(error) {
    recorder.finalize(this.record, { status: 'rejected', reason: error, captureReason: true });
  }

  /**
   * Runs a callback-style `original` with tracing suppressed (whatever Node
   * does internally must not become records). Tracks an object result (e.g. a
   * Timeout, so `clearTimeout` can find the record) and closes the record as
   * rejected if the call throws synchronously.
   */
  run(original, thisArg, args) {
    try {
      const result = context.withTracingSuppressed(original, thisArg, args);
      if (result !== null && typeof result === 'object') this.track(result);
      return result;
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }

  /**
   * Runs a promise-returning `original` as a native call (tracing suppressed
   * and species lookups ignored), tracks the returned promise, and closes the
   * record as rejected if the call throws synchronously. The record is closed
   * later, when the promise is observed (see `patches/promise-prototype.js`).
   */
  runPromiseApi(original, thisArg, args) {
    try {
      const promise = context.callNative(original, thisArg, args);
      this.track(promise);
      return promise;
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }
}

/**
 * Decides whether the current call must be traced and, if so, opens a record.
 * Returns a `Trace`, or `null` when the call must be passed through untouched
 * (tracing is suppressed, or `accept(callSite)` is false).
 *
 *  - type / origin / combinatorMethod: copied to the record.
 *  - accept:  predicate over the call site (default: `userInitiated`).
 *  - details: optional THUNK returning extra record fields. It is lazy so it
 *             is never evaluated (and never reads user arguments) for calls
 *             that end up not being traced.
 */
function beginTrace({ type, origin, combinatorMethod, accept = userInitiated, details }) {
  if (context.isTracingSuppressed()) return null;
  const callSite = captureCallSite();
  if (!accept(callSite)) return null;

  const record = recorder.begin({
    type,
    origin,
    combinatorMethod,
    triggerAsyncId: context.currentAsyncId(),
    callSite,
    details: details ? details() : undefined,
  });
  return new Trace(record, callSite);
}

module.exports = { beginTrace, wrapCallback, Trace, userInitiated, directUserCall, describeTarget, targetDetails };
