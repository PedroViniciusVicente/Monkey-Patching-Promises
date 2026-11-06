'use strict';

/**
 * child-process-runner.js — roda no processo PAI.
 * Inicia o comando de teste como processo filho e injeta o preload nele.
 *
 * Usamos NODE_OPTIONS (e não "node -r ...") porque o comando costuma ser
 * "npx mocha ...", que cria outros processos Node por baixo. NODE_OPTIONS é
 * herdado por todos eles.
 */

const path = require('path');
const { spawn } = require('child_process');

const PRELOAD_SCRIPT = path.join(__dirname, 'preload.js');

function runTracedTestCommand({ projectDir, testCommand, outputPath }) {
  return new Promise((resolve, reject) => {
    const existing = process.env.NODE_OPTIONS || '';
    const preloadFlag = `--require "${PRELOAD_SCRIPT}"`;

    const env = {
      ...process.env,
      NODE_OPTIONS: existing ? `${existing} ${preloadFlag}` : preloadFlag,
      PROMISE_TRACER_OUTPUT: outputPath, // lido pelo preload.js
    };

    const child = spawn(testCommand, { cwd: projectDir, env, stdio: 'inherit', shell: true });
    child.on('error', (err) => reject(new Error(`Falha ao iniciar o comando de teste: ${err.message}`)));
    child.on('exit', (code, signal) => resolve({ code, signal }));
  });
}

module.exports = { runTracedTestCommand };
