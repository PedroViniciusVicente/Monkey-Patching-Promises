'use strict';

const path = require('path');
const { spawn } = require('child_process');

const PRELOAD_SCRIPT = path.join(__dirname, 'preload.js');

/**
 * child-process-runner.js
 * ---------------------------------------------------------------------------
 * Este módulo roda no processo PAI (o orquestrador `cli.js`), nunca no
 * processo sob teste — por isso pode usar `Promise`/`async`/`await`
 * livremente, sem nenhum risco de "auto-rastreamento".
 *
 * Faz o spawn do comando de teste do projeto alvo como processo filho, com
 * o script de preload do tracer injetado via `NODE_OPTIONS=--require`, para
 * que ele rode ANTES de qualquer código do projeto alvo (incluindo o
 * próprio Mocha) ser carregado.
 *
 * Usamos `NODE_OPTIONS` (em vez de reescrever o comando para prefixar
 * `node -r ...`) porque o comando de teste recebido normalmente não é um
 * `node ...` puro — é tipicamente `npx mocha ...`, que por sua vez invoca
 * Node por baixo dos panos de formas que não queremos ter que prever ou
 * parsear. `NODE_OPTIONS` é respeitado por qualquer processo Node que o
 * shell venha a criar como parte de rodar esse comando, incluindo os
 * disparados pelo bin script do `npx`/`mocha`.
 */
function runTracedTestCommand({ projectDir, testCommand, outputPath }) {
  return new Promise((resolve, reject) => {
    const existingNodeOptions = process.env.NODE_OPTIONS || '';
    const preloadFlag = `--require "${PRELOAD_SCRIPT}"`;

    const childEnv = {
      ...process.env,
      NODE_OPTIONS: existingNodeOptions ? `${existingNodeOptions} ${preloadFlag}` : preloadFlag,
      PROMISE_TRACER_OUTPUT: path.resolve(outputPath),
      PROMISE_TRACER_PROJECT_DIR: path.resolve(projectDir),
    };

    const child = spawn(testCommand, {
      cwd: projectDir,
      env: childEnv,
      stdio: 'inherit',
      shell: true, // o comando de teste é uma string de shell completa (pode ter aspas, flags, etc.)
    });

    child.on('error', (err) => {
      reject(new Error(`Falha ao iniciar o comando de teste: ${err.message}`));
    });

    child.on('exit', (code, signal) => {
      resolve({ code, signal });
    });
  });
}

module.exports = { runTracedTestCommand };
