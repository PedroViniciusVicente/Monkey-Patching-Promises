'use strict';

const { captureCreationStack } = require('./stack-utils');
const { safeSerialize } = require('./safe-serializer');
const { nextInternalId } = require('./id-generator');

/**
 * promise-patcher.js
 * ---------------------------------------------------------------------------
 * Envolve o construtor global `Promise` (e seus métodos estáticos) em um
 * Proxy para observar:
 *   - todo call site de `new Promise(executor)` (com stack trace de criação)
 *   - o valor passado para `resolve()`/`reject()` dentro daquele executor
 *   - toda chamada a Promise.resolve / Promise.reject / Promise.all /
 *     Promise.allSettled / Promise.race / Promise.any
 *
 * LIMITAÇÃO IMPORTANTE (detalhada também no README.md):
 * A V8 tem um fast-path interno para `.then()`/`.catch()`/`.finally()` que,
 * quando o `constructor` da Promise ainda aponta para o `Promise` original
 * (intrínseco, não modificado), PULA a chamada a `new Promise(...)` por
 * performance. Nós deliberadamente NÃO sobrescrevemos
 * `Promise.prototype.constructor` para forçar esse caminho a passar pelo
 * nosso Proxy, porque isso desligaria essa otimização da V8 para TODA a
 * suíte de testes (impacto real de performance) e poderia mudar
 * comportamento observável pela spec (lookups de species constructor).
 *
 * Ou seja: sozinho, este Proxy só enxerga Promises criadas via `new
 * Promise(...)` explícito ou via os métodos estáticos combinadores acima —
 * NÃO Promises criadas internamente por `.then()`, retorno de `async
 * function`, ou `await`. É exatamente por isso que a ferramenta também usa
 * async_hooks (ver async-hook-tracker.js): o tipo de recurso PROMISE do
 * async_hooks é alimentado pelos "promise hooks" nativos da V8, e dispara
 * para QUALQUER Promise, não importa qual caminho JS a criou. As duas
 * camadas são correlacionadas via a pilha `pendingConstructionStack` abaixo.
 */
function createPromisePatcher({ logger }) {
  const OriginalPromise = global.Promise;

  // Pilha de construções "em voo", ainda não correlacionadas com um asyncId
  // pelo async-hook-tracker.js. É uma pilha (não um único slot) por robustez
  // defensiva contra `new Promise(...)` aninhado e síncrono dentro de um
  // executor (ex: `new Promise(r => { new Promise(...); r(); })`).
  const pendingConstructionStack = [];

  // Enquanto uma chamada a um método estático combinador (Promise.all etc.)
  // está em andamento, marcamos aqui o nome do método — assim, quando o
  // `construct` trap disparar por causa do `new this(...)` interno que o
  // spec faz dentro desses métodos (NewPromiseCapability), sabemos rotular
  // a Promise resultante com a origem correta.
  let activeCombinator = null;

  function wrapExecutor(originalExecutor, record) {
    if (typeof originalExecutor !== 'function') {
      // `new Promise()` com executor não-função lança nativamente de
      // qualquer forma; deixamos o Reflect.construct propagar esse erro.
      return originalExecutor;
    }

    return function patchedExecutor(resolve, reject) {
      const guardedResolve = (value) => {
        if (!record.settleCapture) record.settleCapture = { outcome: 'fulfilled', value };
        return resolve(value);
      };
      const guardedReject = (reason) => {
        if (!record.settleCapture) record.settleCapture = { outcome: 'rejected', reason };
        return reject(reason);
      };

      try {
        return originalExecutor(guardedResolve, guardedReject);
      } catch (executorError) {
        // Um executor que lança rejeita implicitamente a Promise com o
        // valor lançado (pela spec) — capturamos isso também, a menos que
        // resolve/reject já tenham assentado o resultado antes.
        if (!record.settleCapture) {
          record.settleCapture = { outcome: 'rejected', reason: executorError };
        }
        throw executorError;
      }
    };
  }

  function removeFromStack(record) {
    const idx = pendingConstructionStack.lastIndexOf(record);
    if (idx !== -1) {
      pendingConstructionStack.splice(idx, 1);
      return true; // ainda estava pendente => async_hooks nunca consumiu
    }
    return false;
  }

  const PromiseProxy = new Proxy(OriginalPromise, {
    construct(target, args, newTarget) {
      const record = {
        internalId: nextInternalId('ctor'),
        origin: activeCombinator ? 'combinator' : 'constructor',
        combinatorMethod: activeCombinator ? activeCombinator.methodName : null,
        stack: captureCreationStack('new Promise()'),
        createdAtHr: process.hrtime.bigint(),
        createdAtIso: new Date().toISOString(),
        settleCapture: null,
      };

      pendingConstructionStack.push(record);

      const [executorArg, ...rest] = args;
      let instance;
      try {
        instance = Reflect.construct(target, [wrapExecutor(executorArg, record), ...rest], newTarget);
      } catch (constructError) {
        removeFromStack(record);
        logFallback(record, { constructFailed: true });
        throw constructError;
      }

      // Se o hook `init` do async_hooks já tirou este registro da pilha
      // (ver async-hook-tracker.js), ótimo — a correlação foi feita lá. Se
      // AINDA estiver na pilha aqui, é porque async_hooks não está ativo ou
      // algo inesperado aconteceu: logamos diretamente como fallback, para
      // nunca perder o evento silenciosamente.
      const wasStillPending = removeFromStack(record);
      if (wasStillPending) {
        logFallback(record);
      }

      return instance;
    },

    get(target, prop, receiver) {
      if (['resolve', 'reject', 'all', 'allSettled', 'race', 'any'].includes(prop)) {
        return wrapStaticMethod(target, prop);
      }
      return Reflect.get(target, prop, receiver);
    },
  });

  function wrapStaticMethod(target, methodName) {
    const original = target[methodName];
    return function patchedStaticMethod(...args) {
      const previous = activeCombinator;
      activeCombinator = { methodName };
      try {
        // IMPORTANTE: o `this` usado aqui precisa ser o PROXY, não `target`
        // (o Promise original). A spec de Promise.all/allSettled/race/any/
        // resolve/reject faz `NewPromiseCapability(this)` e depois
        // `new this(...)` internamente. Se `this` fosse o Promise original,
        // essa construção interna chamaria `new OriginalPromise(...)`
        // diretamente, pulando por completo nosso `construct` trap - foi
        // exatamente esse bug que os testes contra a suíte de exemplo
        // pegaram (nenhuma Promise de Promise.all aparecia com
        // origin: 'combinator'). Usando `PromiseProxy` como `this`, a
        // construção interna volta a passar pelo trap acima.
        return Reflect.apply(original, PromiseProxy, args);
      } finally {
        activeCombinator = previous;
      }
    };
  }

  function logFallback(record, extra = {}) {
    try {
      logger.write({
        internalId: record.internalId,
        asyncId: null,
        triggerAsyncId: null,
        origin: record.origin,
        combinatorMethod: record.combinatorMethod || null,
        status: extra.constructFailed
          ? 'construct-failed'
          : record.settleCapture
          ? record.settleCapture.outcome
          : 'created-no-async-hooks-correlation',
        value: record.settleCapture
          ? safeSerialize(record.settleCapture.outcome === 'fulfilled' ? record.settleCapture.value : record.settleCapture.reason)
          : undefined,
        createdAt: record.createdAtIso,
        settledAt: new Date().toISOString(),
        durationMs: null,
        continuationRuns: 0,
        testFile: null,
        stack: record.stack.frames,
        note: 'Não correlacionado com async_hooks (ver README → Limitações conhecidas).',
      });
    } catch (err) {
      try {
        process.stderr.write(`[promise-monkey-tracer] erro no logFallback: ${err && err.message}\n`);
      } catch {
        /* nada mais a fazer */
      }
    }
  }

  // Consumido pelo async-hook-tracker.js dentro do hook `init`.
  function consumePendingConstruction() {
    return pendingConstructionStack.length ? pendingConstructionStack.pop() : null;
  }

  function install() {
    global.Promise = PromiseProxy;
  }

  return { install, consumePendingConstruction, OriginalPromise };
}

module.exports = { createPromisePatcher };
