'use strict';

/**
 * wrap.js
 *
 * Construtores genéricos de wrappers, reaproveitados pelos patches de `patches/`:
 *
 *  - wrapCallback:     embrulha um callback (contexto + registro).
 *  - wrapCallbackApi:  API no estilo callback (fs.readFile, setTimeout, nextTick...).
 *  - wrapPromiseApi:   API que devolve promise (fs.promises.readFile...).
 *
 * Cada patch só precisa dizer QUAIS funções embrulhar e COMO descrevê-las.
 */

const context = require('./context');
const recorder = require('./recorder');
const { captureCallSite } = require('./callsite');

/** Mantém name/length/propriedades do original (inclusive símbolos como util.promisify.custom). */
function copyFunctionMetadata(original, wrapper) {
  for (const key of Reflect.ownKeys(original)) {
    if (['length', 'name', 'prototype', 'caller', 'arguments'].includes(key)) continue;
    try {
      Object.defineProperty(wrapper, key, Object.getOwnPropertyDescriptor(original, key));
    } catch (_) {
      /* propriedade não configurável: ignora */
    }
  }
  for (const key of ['name', 'length']) {
    try {
      Object.defineProperty(wrapper, key, { value: original[key], configurable: true });
    } catch (_) {
      /* ignora */
    }
  }
  return wrapper;
}

/** Resumo curto e seguro do "alvo" de uma operação de fs (caminho ou fd). */
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

/** `{ target }` para registros de fs, ou undefined se o primeiro argumento não é descritível. */
function targetDetails(args) {
  const target = describeTarget(args[0]);
  return target === null ? undefined : { target };
}

/**
 * Embrulha `callback` para que ele rode no contexto de `record`.
 * O registro é fechado quando o callback COMEÇA (é o momento em que a operação
 * terminou); `repeat: true` (setInterval) mantém o registro aberto.
 */
function wrapCallback(callback, record, { repeat = false, nodeStyleErrors = false } = {}) {
  const wrapped = function tracedCallback(...args) {
    record.noteRun();
    if (!repeat) {
      const failed = nodeStyleErrors && args[0] instanceof Error;
      recorder.finalize(record, failed ? { status: 'rejected', reason: args[0], captureReason: true } : { status: 'fulfilled' });
    }
    return context.runInContext(record.asyncId, callback, this, args);
  };
  return copyFunctionMetadata(callback, wrapped);
}

/**
 * API no estilo callback. `callbackIndex(args)` diz onde está o callback;
 * `accept(callSite)` decide se esta chamada deve ser rastreada.
 */
function wrapCallbackApi({ original, type, origin, callbackIndex, accept, details, repeat = false, nodeStyleErrors = false }) {
  const wrapper = function tracedApi(...args) {
    const index = callbackIndex(args);
    if (index < 0 || typeof args[index] !== 'function' || context.isTracingSuppressed()) {
      return Reflect.apply(original, this, args);
    }
    const callSite = captureCallSite();
    if (!accept(callSite)) return Reflect.apply(original, this, args);

    const record = recorder.begin({
      type,
      origin,
      triggerAsyncId: context.currentAsyncId(),
      callSite,
      details: details ? details(args) : undefined,
    });
    args[index] = wrapCallback(args[index], record, { repeat, nodeStyleErrors });
    try {
      const result = context.withTracingSuppressed(original, this, args);
      if (result !== null && typeof result === 'object') recorder.track(result, record); // Timeout/Immediate (para clear*)
      return result;
    } catch (error) {
      recorder.finalize(record, { status: 'rejected', reason: error, captureReason: true });
      throw error;
    }
  };
  return copyFunctionMetadata(original, wrapper);
}

/** API que devolve promise. O registro fecha quando a promise é observada (then/await). */
function wrapPromiseApi({ original, type, details }) {
  const wrapper = function tracedPromiseApi(...args) {
    if (context.isTracingSuppressed()) return Reflect.apply(original, this, args);
    const callSite = captureCallSite();
    if (!callSite.userInitiated) return Reflect.apply(original, this, args);

    const record = recorder.begin({
      type,
      origin: 'promise-api',
      triggerAsyncId: context.currentAsyncId(),
      callSite,
      details: details ? details(args) : undefined,
    });
    try {
      const promise = context.callNative(original, this, args);
      recorder.track(promise, record);
      return promise;
    } catch (error) {
      recorder.finalize(record, { status: 'rejected', reason: error, captureReason: true });
      throw error;
    }
  };
  return copyFunctionMetadata(original, wrapper);
}

module.exports = { copyFunctionMetadata, describeTarget, targetDetails, wrapCallback, wrapCallbackApi, wrapPromiseApi };
