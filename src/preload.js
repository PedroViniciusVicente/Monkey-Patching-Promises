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
  // Ordem de carregamento importa: o logger captura o `fs` ORIGINAL e os
  // módulos de core/ guardam as funções originais ANTES de qualquer patch.
  const { JsonlLogger } = require('./logger');
  require('./core/intrinsics');
  const recorder = require('./core/recorder');
  const { installAllPatches } = require('./patches');

  const outputPath = process.env.PROMISE_TRACER_OUTPUT;
  const projectDir = process.env.PROMISE_TRACER_PROJECT_DIR
    ? path.resolve(process.env.PROMISE_TRACER_PROJECT_DIR)
    : process.cwd();

  if (!outputPath) {
    process.stderr.write('[promise-monkey-tracer] PROMISE_TRACER_OUTPUT não definido - tracer desativado.\n');
  } else {
    const logger = new JsonlLogger(outputPath);
    recorder.configure({ logger, projectDir });

    // Os patches só são instalados depois de logger/recorder estarem prontos,
    // para que nada da configuração acima seja "auto-rastreado".
    // PROMISE_TRACER_TRACK_AWAIT=0 desliga o rastreamento de `await` (ver
    // patches/promise-prototype.js).
    const installed = installAllPatches({ trackAwait: process.env.PROMISE_TRACER_TRACK_AWAIT !== '0' });

    // Fecha, no fim do processo, tudo que ainda estava pendente (promise nunca
    // resolvida, timer que não chegou a disparar, fire-and-forget...).
    process.on('exit', () => {
      try {
        recorder.flushPending('pending-at-exit');
        logger.closeSync();
      } catch (err) {
        try {
          process.stderr.write(`[promise-monkey-tracer] erro no encerramento: ${err && err.stack}\n`);
        } catch {
          /* nada mais a fazer */
        }
      }
    });

    process.stderr.write(`[promise-monkey-tracer] ativo (${installed.join(', ')}) - escrevendo em ${outputPath}\n`);
  }
} catch (err) {
  try {
    process.stderr.write(`[promise-monkey-tracer] falha ao inicializar: ${err && err.stack}\n`);
  } catch {
    /* verdadeiramente nada mais a fazer aqui */
  }
}
