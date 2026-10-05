'use strict';

const asyncHooks = require('async_hooks');
const { safeSerialize } = require('./safe-serializer');
const { captureCreationStack, guessTestFile } = require('./stack-utils');

/**
 * async-hook-tracker.js
 * ---------------------------------------------------------------------------
 * Esta é a camada AUTORITATIVA para "toda Promise que existe neste
 * processo". O async_hooks do Node é alimentado pelos promise hooks nativos
 * da V8, então, ao contrário do promise-patcher.js (que só enxerga `new
 * Promise(...)` e os combinadores estáticos), este vê Promises criadas por
 * `.then()`, retorno de `async function`, `await`, e qualquer caminho
 * interno/nativo — um superconjunto estrito.
 *
 * Estratégia de correlação com o promise-patcher.js:
 *   `patcher.consumePendingConstruction()` retorna o registro de construção
 *   mais recentemente empilhado e ainda não correlacionado (pilha LIFO).
 *   Pelo algoritmo do construtor de Promise da spec ECMAScript, o objeto
 *   Promise subjacente é alocado (o que dispara nosso hook `init`) ANTES do
 *   executor rodar — então, quando `init` dispara para uma Promise criada
 *   via nosso Proxy, o registro no topo da pilha é garantidamente o dela, e
 *   não de alguma construção aninhada/posterior. Se `init` disparar com a
 *   pilha vazia, a Promise não foi criada via nosso Proxy (ex: veio de
 *   `.then()`), e criamos um registro "nativo" para ela diretamente.
 */
function createAsyncHookTracker({ patcher, logger, projectDir }) {
  const recordsByAsyncId = new Map();

  // Guarda de reentrância: código dentro dos nossos próprios callbacks de
  // hook nunca deve, ele mesmo, ser tratado como "atividade do teste".
  let internalDepth = 0;

  function runInternal(fn) {
    internalDepth++;
    try {
      fn();
    } catch (err) {
      // Um bug no próprio tracer NUNCA pode se propagar para dentro dos
      // callbacks do async_hooks (o Node trata exceções não tratadas ali
      // como erro fatal, o que derrubaria o processo sob teste).
      safeStderr(`erro interno do tracer: ${err && err.stack}`);
    } finally {
      internalDepth--;
    }
  }

  function safeStderr(msg) {
    try {
      process.stderr.write(`[promise-monkey-tracer] ${msg}\n`);
    } catch {
      /* nada mais a fazer */
    }
  }

  const hook = asyncHooks.createHook({
    init(asyncId, type, triggerAsyncId) {
      if (type !== 'PROMISE' || internalDepth > 0) return;
      runInternal(() => {
        const pending = patcher.consumePendingConstruction();
        const record = pending || {
          internalId: `native_${asyncId}`,
          origin: 'native', // criada fora do nosso Proxy (.then/async-await/etc.)
          combinatorMethod: null,
          stack: captureCreationStack('native-init'),
          createdAtHr: process.hrtime.bigint(),
          createdAtIso: new Date().toISOString(),
          settleCapture: null,
        };
        record.asyncId = asyncId;
        record.triggerAsyncId = triggerAsyncId;
        record.continuationRuns = 0;
        record.finalized = false;
        recordsByAsyncId.set(asyncId, record);
      });
    },

    before(asyncId) {
      if (internalDepth > 0) return;
      const record = recordsByAsyncId.get(asyncId);
      if (record) record.continuationRuns += 1;
    },

    after() {
      // Minimalista de propósito: para este protótipo só precisamos da
      // CONTAGEM de execuções de continuação (capturada em `before`).
      // TODO: estender para capturar duração por continuação, se necessário.
    },

    promiseResolve(asyncId) {
      if (internalDepth > 0) return;
      runInternal(() => finalizeRecord(asyncId, 'promiseResolve'));
    },

    destroy(asyncId) {
      if (internalDepth > 0) return;
      runInternal(() => {
        const record = recordsByAsyncId.get(asyncId);
        if (record && !record.finalized) {
          // O recurso está sendo destruído sem nunca termos observado
          // `promiseResolve` — acontece com Promises que ficam pendentes
          // pelo resto da vida do processo. Fazemos o flush do que temos.
          finalizeRecord(asyncId, 'destroy');
        }
        recordsByAsyncId.delete(asyncId);
      });
    },
  });

  function finalizeRecord(asyncId, finalizedVia) {
    const record = recordsByAsyncId.get(asyncId);
    if (!record || record.finalized) return;
    record.finalized = true;

    const settledAtHr = process.hrtime.bigint();
    const durationMs = record.createdAtHr ? Number(settledAtHr - record.createdAtHr) / 1e6 : null;

    let status = 'pending';
    let value;
    if (record.settleCapture) {
      status = record.settleCapture.outcome; // 'fulfilled' | 'rejected'
      value = safeSerialize(
        record.settleCapture.outcome === 'fulfilled' ? record.settleCapture.value : record.settleCapture.reason
      );
    } else if (finalizedVia === 'promiseResolve') {
      // Sabemos que a Promise saiu do estado pendente, mas — como ela não
      // foi criada via `new Promise(...)` através do nosso Proxy (ou o
      // wrapping de resolve/reject não se aplicou, ex: Promise.resolve(x)
      // com x já sendo uma Promise, que é retornada diretamente) — não
      // temos como saber se ela terminou cumprida ou rejeitada, nem seu
      // valor. Limitação conhecida e documentada no README.md.
      status = 'settled-outcome-unknown';
    } else if (finalizedVia === 'destroy') {
      status = 'pending-at-destroy';
    }

    logger.write({
      internalId: record.internalId,
      asyncId: record.asyncId,
      triggerAsyncId: record.triggerAsyncId,
      origin: record.origin,
      combinatorMethod: record.combinatorMethod || null,
      status,
      value,
      createdAt: record.createdAtIso,
      settledAt: new Date().toISOString(),
      durationMs,
      continuationRuns: record.continuationRuns || 0,
      testFile: guessTestFile(record.stack ? record.stack.frames : [], projectDir),
      stack: record.stack ? record.stack.frames : [],
    });
  }

  function flushRemaining(reasonLabel = 'process-exit') {
    for (const asyncId of recordsByAsyncId.keys()) {
      finalizeRecord(asyncId, reasonLabel);
    }
  }

  function enable() {
    hook.enable();
  }

  return { enable, flushRemaining };
}

module.exports = { createAsyncHookTracker };
