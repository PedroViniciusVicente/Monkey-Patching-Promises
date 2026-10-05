'use strict';

/**
 * preload.js
 * ---------------------------------------------------------------------------
 * Este arquivo é a ÚNICA coisa injetada no processo filho (de teste), via
 * `NODE_OPTIONS="--require /caminho/absoluto/para/preload.js"`. Ele roda e
 * termina sua configuração ANTES de qualquer código do projeto alvo (ou do
 * próprio Mocha) ser carregado — é exatamente essa a garantia que `--require`
 * dá.
 *
 * Tudo aqui precisa ser defensivo: se QUALQUER COISA lançar, logamos em
 * stderr e saímos do caminho, em vez de deixar um erro do tracer abortar ou
 * alterar a execução dos testes.
 *
 * // TODO: extend for ESM support (module.register / --experimental-loader)
 * // TODO: extend for Jest support (hoje o preload assume um único processo
 * //       Node rodando Mocha; Jest normalmente usa workers/processos filhos
 * //       próprios, que precisariam receber o mesmo NODE_OPTIONS)
 */
try {
  const path = require('path');
  const { JsonlLogger } = require('./logger');
  const { createPromisePatcher } = require('./promise-patcher');
  const { createAsyncHookTracker } = require('./async-hook-tracker');

  const outputPath = process.env.PROMISE_TRACER_OUTPUT;
  const projectDir = process.env.PROMISE_TRACER_PROJECT_DIR
    ? path.resolve(process.env.PROMISE_TRACER_PROJECT_DIR)
    : process.cwd();

  if (!outputPath) {
    process.stderr.write('[promise-monkey-tracer] PROMISE_TRACER_OUTPUT não definido - tracer desativado.\n');
  } else {
    const logger = new JsonlLogger(outputPath);
    const patcher = createPromisePatcher({ logger });
    const tracker = createAsyncHookTracker({ patcher, logger, projectDir });

    // Ordem importa: habilitamos o async_hooks e instalamos o Proxy do
    // Promise só depois que logger/patcher/tracker já foram totalmente
    // construídos — assim, nada na configuração acima corre risco de ser
    // "auto-rastreado" pelo próprio patch.
    tracker.enable();
    patcher.install();

    // Flush best-effort de qualquer Promise que ainda esteja pendente
    // quando o processo terminar (ex: uma Promise nunca resolvida de
    // propósito, ou o test runner saindo antes de a fila de microtasks
    // esvaziar totalmente em algum caso extremo).
    process.on('exit', () => {
      try {
        tracker.flushRemaining('process-exit');
        logger.closeSync();
      } catch (err) {
        try {
          process.stderr.write(`[promise-monkey-tracer] erro no encerramento: ${err && err.stack}\n`);
        } catch {
          /* nada mais a fazer */
        }
      }
    });

    process.stderr.write(`[promise-monkey-tracer] ativo - escrevendo em ${outputPath}\n`);
  }
} catch (err) {
  try {
    process.stderr.write(`[promise-monkey-tracer] falha ao inicializar: ${err && err.stack}\n`);
  } catch {
    /* verdadeiramente nada mais a fazer aqui */
  }
}
