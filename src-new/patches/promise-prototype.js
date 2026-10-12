'use strict';

/**
 * patches/promise-prototype.js
 *
 * Objeto patcheado: `Promise.prototype` (`then`, `finally` e o `constructor`).
 *
 * É aqui que o tracer entende o encadeamento de promises e o `await`:
 *
 *  - `then` (e, por consequência, `catch`): cria um registro "derived" cujo
 *    triggerAsyncId é a promise pai, e roda o callback no contexto dele.
 *
 *  - `await`: o V8 NÃO chama `then` num `await` de promise nativa (usa um
 *    caminho interno otimizado), então não há onde interceptar a continuação.
 *    Para tornar o `await` observável, trocamos `Promise.prototype.constructor`
 *    por um getter. Durante o `await`, a especificação lê `promise.constructor`;
 *    se o valor for diferente do `Promise` intrínseco, o motor passa a tratar a
 *    promise como "thenable" e chama o nosso `then` num job de microtask.
 *    Assim sabemos (1) em que contexto o `await` foi escrito e (2) quando a
 *    continuação vai rodar. Veja `context.scheduleAwaitContext`.
 *
 *    Custo: um `await` passa a levar 3 ticks de microtask em vez de 1 (o
 *    comportamento do Node <= 10). Desligue com PROMISE_TRACER_TRACK_AWAIT=0.
 */

const { RealPromise, originalThen, originalFinally, isNativePromise } = require('../core/intrinsics');
const context = require('../core/context');
const recorder = require('../core/recorder');
const { captureCallSite, isNodeBuiltinFile, isSyncFrame } = require('../core/callsite');
const { copyFunctionMetadata } = require('../core/wrap');

// Contextos dos `await` ainda não consumidos, por promise aguardada (FIFO).
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

/** Registro da promise; se ela ainda não era conhecida (ex.: retorno de async function), cria um "observed". */
function recordForPromise(promise, callSite, triggerAsyncId = context.currentAsyncId()) {
  let record = recorder.recordOf(promise);
  if (!record) {
    record = recorder.begin({ type: 'Promise', origin: 'observed', triggerAsyncId, callSite });
    recorder.track(promise, record);
  }
  return record;
}

/** A promise pai acabou de liquidar (sabemos porque uma reação dela está rodando). */
function settleParent(record, branch, argument) {
  if (!record.isOpen) return;
  recorder.finalize(
    record,
    branch === 'rejected' ? { status: 'rejected', reason: argument, captureReason: true } : { status: 'fulfilled' },
  );
}

const passThrough = (promise, onFulfilled, onRejected) => context.callNative(originalThen, promise, [onFulfilled, onRejected]);

/** Reação (um dos dois ramos de um `.then`) que roda o handler do usuário no contexto da promise derivada. */
function createReaction(branch, handler, parentRecord, derivedRecord) {
  return function tracedReaction(argument) {
    settleParent(parentRecord, branch, argument);
    derivedRecord.noteRun();

    if (typeof handler !== 'function') {
      // Sem handler neste ramo: a derivada apenas repassa o resultado do pai.
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
 * `then` chamado pelo motor para um `await` (job "thenable"). Os dois callbacks
 * são as funções nativas resolve/reject da promise interna do `await`. Depois de
 * chamar uma delas a continuação do `await` fica agendada, e registramos em que
 * contexto ela vai rodar.
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

function tracedThen(onFulfilled, onRejected) {
  if (!isNativePromise(this)) return Reflect.apply(originalThen, this, [onFulfilled, onRejected]); // o nativo lança o TypeError

  const awaitEntry = takeAwaitEntry(this);
  if (awaitEntry) return reactToAwait(this, awaitEntry, onFulfilled, onRejected);

  if (context.isTracingSuppressed()) return passThrough(this, onFulfilled, onRejected);
  const callSite = captureCallSite();
  if (!callSite.userInitiated) return passThrough(this, onFulfilled, onRejected);
  return reactToUserThen(this, callSite, onFulfilled, onRejected);
}

// `finally` lê `this.constructor` (SpeciesConstructor) antes de chamar o nosso `then`.
function tracedFinally(onFinally) {
  return context.withSpeciesLookup(originalFinally, this, [onFinally]);
}

/** Troca `Promise.prototype.constructor` por um getter que enxerga os `await` do usuário. */
function installAwaitProbe() {
  // Só precisa ser diferente do Promise intrínseco; [Symbol.species] garante que
  // `then`/`finally` continuem criando promises comuns.
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
      // O frame mais interno é onde o `await` está escrito. Se for código do
      // próprio Node, mantemos o caminho rápido (sem tracing, sem custo extra).
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
  RealPromise.prototype.then = copyFunctionMetadata(originalThen, tracedThen);
  RealPromise.prototype.finally = copyFunctionMetadata(originalFinally, tracedFinally);
  if (trackAwait) installAwaitProbe();
}

module.exports = { name: 'Promise.prototype', install };
