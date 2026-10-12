'use strict';

/**
 * context.js
 *
 * Rastreia, SEM async_hooks, "qual recurso assíncrono está executando agora".
 * É isso que permite preencher o `triggerAsyncId` de cada novo registro.
 *
 * Duas fontes de contexto:
 *
 *  1. Contexto explícito (`runInContext`): os patches embrulham cada callback
 *     (fs, timers, nextTick, .then...) e, enquanto ele roda, o contexto é o
 *     `asyncId` do recurso que o originou.
 *
 *  2. Contexto de `await` (`scheduleAwaitContext`): o código que continua
 *     depois de um `await` NÃO passa por nenhum callback que possamos embrulhar.
 *     O patch de `Promise.prototype` consegue, porém, saber exatamente qual
 *     promise estava sendo aguardada e quando a continuação vai rodar (ela é o
 *     próximo job da fila de microtasks depois do nosso). Por isso mantemos uma
 *     fila FIFO de ids: cada entrada vale apenas até a microtask-marcador
 *     enfileirada logo depois da continuação (ver `scheduleAwaitContext`).
 */

const { ROOT_ASYNC_ID } = require('./ids');
const { originalQueueMicrotask } = require('./intrinsics');

let explicitContextId = null;
const pendingAwaitContextIds = [];
let suppressedDepth = 0;
let speciesLookupDepth = 0;

/** asyncId do recurso cujo código está executando neste instante. */
function currentAsyncId() {
  if (explicitContextId !== null) return explicitContextId;
  if (pendingAwaitContextIds.length > 0) return pendingAwaitContextIds[0];
  return ROOT_ASYNC_ID;
}

/** Executa `fn` com `asyncId` como contexto, restaurando o anterior no fim. */
function runInContext(asyncId, fn, thisArg, args) {
  const previous = explicitContextId;
  explicitContextId = asyncId;
  try {
    return Reflect.apply(fn, thisArg, args);
  } finally {
    explicitContextId = previous;
  }
}

/**
 * Registra que a continuação de um `await` vai rodar "dentro" de `asyncId`.
 *
 * Chamado logo depois de resolver a promise interna do `await`: isso enfileira a
 * continuação (job J). Em seguida enfileiramos uma microtask-marcador, que fica
 * imediatamente depois de J na fila. J enxerga `asyncId` na cabeça da fila e o
 * marcador remove a entrada. Como a fila de microtasks é FIFO, várias
 * continuações intercaladas continuam recebendo cada uma o seu próprio contexto.
 */
function scheduleAwaitContext(asyncId) {
  pendingAwaitContextIds.push(asyncId);
  originalQueueMicrotask(() => {
    pendingAwaitContextIds.shift();
  });
}

/**
 * Chama uma função NATIVA (original) em nome do tracer:
 *  - tracing suspenso: o que o Node faz por dentro não vira registro;
 *  - lookup de espécie: leituras de `promise.constructor` feitas pela própria
 *    implementação nativa não são confundidas com um `await` do usuário.
 */
function callNative(fn, thisArg, args) {
  suppressedDepth += 1;
  speciesLookupDepth += 1;
  try {
    return Reflect.apply(fn, thisArg, args);
  } finally {
    suppressedDepth -= 1;
    speciesLookupDepth -= 1;
  }
}

/** Só o lookup de espécie (para métodos nativos que depois chamam o `then` embrulhado). */
function withSpeciesLookup(fn, thisArg, args) {
  speciesLookupDepth += 1;
  try {
    return Reflect.apply(fn, thisArg, args);
  } finally {
    speciesLookupDepth -= 1;
  }
}

/** Só a supressão de tracing (usada pelo recorder ao escrever o log). */
function withTracingSuppressed(fn, thisArg, args) {
  suppressedDepth += 1;
  try {
    return Reflect.apply(fn, thisArg, args);
  } finally {
    suppressedDepth -= 1;
  }
}

const isTracingSuppressed = () => suppressedDepth > 0;
const isSpeciesLookup = () => speciesLookupDepth > 0;

module.exports = {
  currentAsyncId,
  runInContext,
  scheduleAwaitContext,
  callNative,
  withSpeciesLookup,
  withTracingSuppressed,
  isTracingSuppressed,
  isSpeciesLookup,
};
