'use strict';

/**
 * patches/promise.js
 *
 * Objeto patcheado: o construtor global `Promise` e seus métodos estáticos.
 *
 * Cobre o que o usuário escreve explicitamente:
 *   new Promise(executor)
 *   Promise.resolve / reject / all / allSettled / race / any / withResolvers
 *
 * `then`, `catch`, `finally` e `await` são tratados em `promise-prototype.js`.
 *
 * Como funciona: `globalThis.Promise` passa a ser um Proxy do construtor
 * original. O Proxy intercepta `new Promise(...)` (trap `construct`) e o acesso
 * aos estáticos (trap `get`). Promises criadas pelo próprio Node usam os
 * "primordials" e não passam por aqui — por isso não viram ruído no log.
 */

const { RealPromise, isNativePromise } = require('../core/intrinsics');
const context = require('../core/context');
const recorder = require('../core/recorder');
const { captureCallSite } = require('../core/callsite');
const { copyFunctionMetadata } = require('../core/wrap');

const COMBINATORS_WITH_INPUTS = ['all', 'allSettled', 'race', 'any'];
const PATCHED_STATICS = ['resolve', 'reject', 'all', 'allSettled', 'race', 'any', 'withResolvers'];

/** Resolve de uma promise: quando o valor é outra promise, o resultado depende dela ("adopted"). */
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

/** Embrulha o executor para observar resolve/reject e rodar o código dele no contexto da promise. */
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

function install() {
  const staticWrappers = new Map();

  const proxy = new Proxy(RealPromise, {
    construct(target, args, newTarget) {
      const nativeNewTarget = newTarget === proxy ? target : newTarget;
      const executor = args[0];
      if (typeof executor !== 'function' || context.isTracingSuppressed()) {
        return Reflect.construct(target, args, nativeNewTarget);
      }
      const callSite = captureCallSite();
      if (!callSite.userInitiated) return Reflect.construct(target, args, nativeNewTarget);

      const record = recorder.begin({
        type: 'Promise',
        origin: 'constructor',
        triggerAsyncId: context.currentAsyncId(),
        callSite,
      });
      const promise = Reflect.construct(target, [wrapExecutor(executor, record), ...args.slice(1)], nativeNewTarget);
      recorder.track(promise, record);
      return promise;
    },

    get(target, property, receiver) {
      if (typeof property === 'string' && staticWrappers.has(property)) return staticWrappers.get(property);
      return Reflect.get(target, property, receiver);
    },
  });

  // `this` dos estáticos: se for o próprio Proxy, usamos o construtor nativo para
  // que o NewPromiseCapability interno não passe pelo trap `construct` de novo.
  const nativeConstructorFor = (thisArg) => (thisArg === proxy || thisArg === undefined ? RealPromise : thisArg);

  for (const method of PATCHED_STATICS) {
    const original = RealPromise[method];
    if (typeof original !== 'function') continue;

    const wrapper = function tracedStatic(...args) {
      const constructor = nativeConstructorFor(this);
      if (context.isTracingSuppressed()) return Reflect.apply(original, constructor, args);
      const callSite = captureCallSite();
      if (!callSite.userInitiated) return Reflect.apply(original, constructor, args);

      const record = recorder.begin({
        type: `Promise.${method}`,
        origin: 'combinator',
        combinatorMethod: method,
        triggerAsyncId: context.currentAsyncId(),
        callSite,
        details: describeInputs(method, args),
      });

      let result;
      try {
        result = context.callNative(original, constructor, args);
      } catch (error) {
        settleOnReject(record, error);
        throw error;
      }

      if (method === 'withResolvers') return wrapWithResolvers(result, record);

      // Promise.resolve(p) devolve a própria p: este registro é só um apelido.
      if (result === args[0]) {
        recorder.finalize(record, { status: 'aliased' });
        return result;
      }
      recorder.track(result, record);
      if (method === 'resolve') settleOnResolve(record, args[0]);
      if (method === 'reject') settleOnReject(record, args[0]);
      return result;
    };
    staticWrappers.set(method, copyFunctionMetadata(original, wrapper));
  }

  globalThis.Promise = proxy;
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

module.exports = { name: 'Promise', install };
