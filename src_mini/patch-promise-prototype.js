'use strict';

/**
 * patch-promise-prototype.js — intercepta `promise.then(onFulfilled, onRejected)`
 * ---------------------------------------------------------------------------
 * Diferente do construtor, aqui não há Proxy: `Promise.prototype.then` é
 * SOBRESCRITO no próprio objeto. Por isso o original foi guardado antes
 * (tracer.originalThen) — depois da troca não existe outro caminho até ele.
 *
 * Cada `.then` cria uma promise DERIVADA. Para ela criamos um registro:
 *   - triggerAsyncId = asyncId da promise pai (se a pai for rastreada)
 *   - os callbacks são trocados por versões que rodam no contexto da derivada
 *     (o que for criado dentro do callback terá a derivada como trigger)
 *     e que fecham o registro conforme o resultado do callback
 *
 * `.catch(cb)` e `.finally(cb)` NÃO precisam de patch próprio: o V8 os
 * implementa chamando `this.then(...)`, que já é a nossa versão.
 *
 * NÃO coberto neste protótipo: `await`. O V8 não passa por `.then` ao fazer
 * await de uma promise nativa. O código depois do await roda com trigger = 1.
 */

const tracer = require('./tracer');

function install() {
  const { originalThen, isNativePromise } = tracer;

  Promise.prototype.then = function then(onFulfilled, onRejected) {
    // `this` não é uma promise nativa: deixa o original lançar o TypeError correto.
    if (!isNativePromise(this)) return Reflect.apply(originalThen, this, [onFulfilled, onRejected]);

    const parent = tracer.recordOf(this);
    const derived = tracer.begin({
      type: 'Promise.then',
      origin: 'derived',
      triggerAsyncId: parent ? parent.asyncId : undefined, // sem pai rastreado: usa o contexto atual
    });
    if (!derived) return Reflect.apply(originalThen, this, [onFulfilled, onRejected]);

    // Sem callback, a derivada apenas repassa o resultado da pai.
    const handleFulfilled =
      typeof onFulfilled === 'function'
        ? wrapCallback(derived, onFulfilled)
        : (value) => {
            tracer.settleWithValue(derived, value);
            return value;
          };
    const handleRejected =
      typeof onRejected === 'function'
        ? wrapCallback(derived, onRejected)
        : (reason) => {
            tracer.settle(derived, 'rejected', { reason });
            throw reason;
          };

    const result = Reflect.apply(originalThen, this, [handleFulfilled, handleRejected]);
    tracer.track(result, derived);
    return result;
  };
}

// Executa o callback do usuário no contexto da derivada e fecha o registro
// conforme o que ele devolver (valor, promise) ou lançar.
function wrapCallback(derived, callback) {
  return function tracedCallback(input) {
    try {
      const output = tracer.runInContext(derived.asyncId, callback, undefined, [input]);
      tracer.settleWithValue(derived, output);
      return output;
    } catch (error) {
      tracer.settle(derived, 'rejected', { reason: error });
      throw error;
    }
  };
}

module.exports = { install };
