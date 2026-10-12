'use strict';

/**
 * intrinsics.js
 *
 * Guarda referências para as funções ORIGINAIS (anteriores a qualquer patch)
 * das quais o próprio tracer depende para funcionar. Este módulo precisa ser
 * carregado ANTES de qualquer arquivo de `patches/` ser instalado — o
 * `preload.js` garante essa ordem.
 *
 * Por que isso importa: se o tracer usasse `queueMicrotask` ou `Promise.then`
 * *depois* de eles terem sido substituídos, ele acabaria rastreando a si mesmo
 * (e entraria em recursão infinita).
 */

const util = require('util');

module.exports = {
  RealPromise: Promise,
  originalThen: Promise.prototype.then,
  originalFinally: Promise.prototype.finally,
  originalQueueMicrotask: globalThis.queueMicrotask,

  // `util.types.isPromise` não tem efeitos colaterais (não lê `then` nem
  // `constructor`), ao contrário de checagens do tipo `value.then`.
  isNativePromise: util.types.isPromise,
};
