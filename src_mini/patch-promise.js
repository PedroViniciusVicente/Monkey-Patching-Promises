'use strict';

/**
 * patch-promise.js — intercepta `new Promise(executor)`
 * ---------------------------------------------------------------------------
 * `globalThis.Promise` passa a ser um Proxy em volta do construtor original
 * (tracer.RealPromise). O Proxy NÃO copia nada: o original continua existindo
 * e é o `target` que o motor entrega aos traps.
 *
 * O que acontece em `new Promise(executor)`:
 *   1. o trap `construct` é chamado com (target = RealPromise, args, newTarget)
 *   2. criamos um registro (type "Promise", origin "constructor")
 *   3. trocamos o executor por uma versão que:
 *        - roda dentro do contexto do registro (o que for criado dentro do
 *          executor terá este registro como triggerAsyncId)
 *        - observa resolve/reject para fechar o registro
 *   4. Reflect.construct cria a promise de verdade usando o executor trocado
 *   5. associamos promise → registro (WeakMap) para que `.then` a encontre
 */

const tracer = require('./tracer');

const STATICS = ['resolve', 'reject', 'all', 'allSettled', 'race', 'any', 'withResolvers'];

function install() {
  const { RealPromise } = tracer;

  const proxy = new Proxy(RealPromise, {
    construct(target, args, newTarget) {
      // Se quem chamou foi o próprio Proxy, usa o construtor real como new.target
      // (evita reentrar neste trap). Subclasses (class X extends Promise) são preservadas.
      const nativeNewTarget = newTarget === proxy ? target : newTarget;
      const executor = args[0];

      if (typeof executor !== 'function') return Reflect.construct(target, args, nativeNewTarget);

      const record = tracer.begin({ type: 'Promise', origin: 'constructor' });
      if (!record) return Reflect.construct(target, args, nativeNewTarget);

      const tracedExecutor = (resolve, reject) => {
        const tracedResolve = (value) => {
          tracer.settleWithValue(record, value);
          return resolve(value);
        };
        const tracedReject = (reason) => {
          tracer.settle(record, 'rejected', { reason });
          return reject(reason);
        };
        try {
          return tracer.runInContext(record.asyncId, executor, undefined, [tracedResolve, tracedReject]);
        } catch (error) {
          // executor que lança = promise rejeitada
          tracer.settle(record, 'rejected', { reason: error });
          throw error;
        }
      };

      const promise = Reflect.construct(target, [tracedExecutor], nativeNewTarget);
      tracer.track(promise, record);
      return promise;
    },

    // Os estáticos (Promise.resolve, Promise.all...) NÃO são rastreados no protótipo,
    // mas precisam continuar corretos: chamados como `Promise.resolve(x)` eles
    // receberiam `this = proxy`, e `Promise.resolve(p) === p` deixaria de valer.
    // Por isso devolvemos versões que trocam `this = proxy` por RealPromise.
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (!STATICS.includes(property) || typeof value !== 'function') return value;
      return staticsCache.get(property) || cacheStatic(property, value);
    },
  });

  const staticsCache = new Map();
  function cacheStatic(property, original) {
    const wrapped = new Proxy(original, {
      apply: (target, thisArg, args) =>
        Reflect.apply(target, thisArg === proxy || thisArg === undefined ? RealPromise : thisArg, args),
    });
    staticsCache.set(property, wrapped);
    return wrapped;
  }

  globalThis.Promise = proxy;
}

module.exports = { install };
