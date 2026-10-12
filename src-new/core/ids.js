'use strict';

/**
 * ids.js
 *
 * Gerador de `asyncId` próprio do tracer (NÃO usa async_hooks).
 *
 * O id 1 é reservado para o "contexto raiz": o script principal e qualquer
 * código cuja origem o tracer não consegue atribuir. É a mesma convenção do
 * `executionAsyncId()` do Node, onde o script principal roda com id 1.
 */

const ROOT_ASYNC_ID = 1;
let counter = ROOT_ASYNC_ID;

function nextAsyncId() {
  counter += 1;
  return counter;
}

// `asyncId` reinicia a cada processo; o `pid` evita colisões quando vários
// processos (ex.: npx -> mocha) escrevem no mesmo arquivo de saída.
function internalIdFor(asyncId) {
  return `p${process.pid}_${asyncId}`;
}

module.exports = { ROOT_ASYNC_ID, nextAsyncId, internalIdFor };
