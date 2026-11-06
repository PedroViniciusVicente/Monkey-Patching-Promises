'use strict';

/**
 * preload.js — roda DENTRO do processo filho, antes de qualquer código do projeto.
 * ---------------------------------------------------------------------------
 * Chegou aqui porque o runner definiu NODE_OPTIONS="--require <este arquivo>".
 * Todo processo Node criado pelo comando de teste (npx, mocha...) executa este
 * arquivo, e cada um grava no mesmo log (por isso cada linha tem o `pid`).
 *
 * Ordem importa:
 *   1. require('./tracer')  → captura os originais (Promise, then) ANTES dos patches
 *   2. configure            → diz ao tracer onde gravar o log
 *   3. instala os patches   → a partir daqui Promise e then estão trocados
 *   4. 'exit'               → fecha os registros que nunca terminaram
 *
 * Tudo em try/catch: uma falha do tracer nunca pode derrubar os testes.
 */

try {
  const tracer = require('./tracer');
  const patchPromise = require('./patch-promise');
  const patchPromisePrototype = require('./patch-promise-prototype');

  const outputPath = process.env.PROMISE_TRACER_OUTPUT;
  if (outputPath) {
    tracer.configure({ outputPath });
    patchPromise.install();
    patchPromisePrototype.install();
    process.on('exit', () => tracer.flushPending());
  }
} catch (error) {
  console.error('[promise-monkey-tracer-lite] falha ao inicializar:', error);
}
