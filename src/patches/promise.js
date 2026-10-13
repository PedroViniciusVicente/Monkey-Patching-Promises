'use strict';

/**
 * patches/promise.js
 *
 * Patched object: the global `Promise` constructor and its static methods.
 *
 * Covers what the user writes explicitly:
 *   new Promise(executor)
 *   Promise.resolve / reject / all / allSettled / race / any / withResolvers
 *
 * `then`, `catch`, `finally` and `await` are handled in `promise-prototype.js`.
 *
 * How it works: `globalThis.Promise` becomes a Proxy of the original
 * constructor. The Proxy intercepts `new Promise(...)` (`construct` trap) and
 * access to the statics (`get` trap, which returns a Proxy of each static whose
 * `apply` trap does the tracing). Promises created by Node itself use the
 * "primordials" and never reach this code, so they add no noise to the log.
 */

const { RealPromise, isNativePromise } = require('../core/intrinsics');
const context = require('../core/context');
const recorder = require('../core/recorder');
const { beginTrace } = require('../core/primitives');

const COMBINATORS_WITH_INPUTS = ['all', 'allSettled', 'race', 'any'];
const PATCHED_STATICS = ['resolve', 'reject', 'all', 'allSettled', 'race', 'any', 'withResolvers'];

/** Resolving a promise: when the value is another promise, the outcome depends on it ("adopted"). */
function settleOnResolve(record, value) {
  if (isNativePromise(value)) {
    recorder.finalize(record, { status: 'adopted' });
  } else {
    recorder.finalize(record, { status: 'fulfilled', value, captureValue: true });
  }
}

function settleOnReject(record, reason) {
  recorder.finalize(record, { status: 'rejected', reason, captureReason: true });
}

/** Wraps the executor to observe resolve/reject and to run its code in the promise's context. */
function wrapExecutor(executor, record) {
  return function tracedExecutor(resolve, reject) {
    const tracedResolve = (value) => {
      settleOnResolve(record, value);
      return resolve(value);
    };
    const tracedReject = (reason) => {
      settleOnReject(record, reason);
      return reject(reason);
    };
    try {
      return context.runInContext(record.asyncId, executor, undefined, [tracedResolve, tracedReject]);
    } catch (error) {
      settleOnReject(record, error);
      throw error;
    }
  };
}

function describeInputs(method, args) {
  if (!COMBINATORS_WITH_INPUTS.includes(method) || !Array.isArray(args[0])) return undefined;
  return {
    inputCount: args[0].length,
    dependsOn: args[0]
      .map((input) => recorder.recordOf(input))
      .filter(Boolean)
      .map((record) => record.asyncId),
  };
}

function wrapWithResolvers({ promise, resolve, reject }, record) {
  recorder.track(promise, record);
  return {
    promise,
    resolve: (value) => {
      settleOnResolve(record, value);
      return resolve(value);
    },
    reject: (reason) => {
      settleOnReject(record, reason);
      return reject(reason);
    },
  };
}

function install() {
  const staticProxies = new Map();

  const proxy = new Proxy(RealPromise, {
    construct(target, args, newTarget) {
      const nativeNewTarget = newTarget === proxy ? target : newTarget;
      const executor = args[0];
      if (typeof executor !== 'function') return Reflect.construct(target, args, nativeNewTarget);

      const trace = beginTrace({ type: 'Promise', origin: 'constructor' });
      if (!trace) return Reflect.construct(target, args, nativeNewTarget);

      const promise = Reflect.construct(target, [wrapExecutor(executor, trace.record), ...args.slice(1)], nativeNewTarget);
      trace.track(promise);
      return promise;
    },

    get(target, property, receiver) {
      if (typeof property === 'string' && staticProxies.has(property)) return staticProxies.get(property);
      return Reflect.get(target, property, receiver);
    },
  });

  // `this` of the statics: when it is the Proxy itself, use the native constructor so the
  // internal NewPromiseCapability does not go through the `construct` trap again.
  const nativeConstructorFor = (thisArg) => (thisArg === proxy || thisArg === undefined ? RealPromise : thisArg);

  for (const method of PATCHED_STATICS) {
    const original = RealPromise[method];
    if (typeof original !== 'function') continue;

    staticProxies.set(
      method,
      new Proxy(original, {
        apply(target, thisArg, args) {
          const constructor = nativeConstructorFor(thisArg);

          const trace = beginTrace({
            type: `Promise.${method}`,
            origin: 'combinator',
            combinatorMethod: method,
            details: () => describeInputs(method, args),
          });
          if (!trace) return Reflect.apply(target, constructor, args);

          let result;
          try {
            result = context.callNative(target, constructor, args);
          } catch (error) {
            trace.fail(error);
            throw error;
          }

          if (method === 'withResolvers') return wrapWithResolvers(result, trace.record);

          // Promise.resolve(p) returns p itself: this record is just an alias.
          if (result === args[0]) {
            recorder.finalize(trace.record, { status: 'aliased' });
            return result;
          }
          trace.track(result);
          if (method === 'resolve') settleOnResolve(trace.record, args[0]);
          if (method === 'reject') settleOnReject(trace.record, args[0]);
          return result;
        },
      }),
    );
  }

  globalThis.Promise = proxy;
}

module.exports = { name: 'Promise', install };
