#!/usr/bin/env node
'use strict';

/**
 * cli.js — ponto de entrada (processo PAI).
 *
 * Uso:
 *   node src/cli.js --project-dir /caminho/absoluto --test-command "npx mocha test/x.js" [--output ./logs/trace.jsonl]
 *
 * Fluxo: lê argumentos → prepara o arquivo de log → chama o runner →
 * termina com o mesmo exit code do comando de teste.
 */

const fs = require('fs');
const path = require('path');
const { runTracedTestCommand } = require('./child-process-runner');

function parseArgs(argv) {
  const args = { projectDir: null, testCommand: null, output: './logs/promise-trace.jsonl' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--project-dir') args.projectDir = argv[++i];
    else if (argv[i] === '--test-command') args.testCommand = argv[++i];
    else if (argv[i] === '--output') args.output = argv[++i];
    else throw new Error(`Argumento desconhecido: ${argv[i]}`);
  }
  return args;
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
    if (!args.projectDir || !path.isAbsolute(args.projectDir) || !fs.existsSync(args.projectDir)) {
      throw new Error('--project-dir é obrigatório e deve ser um caminho absoluto existente');
    }
    if (!args.testCommand) throw new Error('--test-command é obrigatório');
  } catch (error) {
    console.error(`Erro: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const outputPath = path.resolve(args.output);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, ''); // começa um log limpo; os processos filhos só fazem append

  console.log('[tracer-lite] projeto :', args.projectDir);
  console.log('[tracer-lite] comando :', args.testCommand);
  console.log('[tracer-lite] output  :', outputPath);
  console.log('---');

  const { code, signal } = await runTracedTestCommand({
    projectDir: args.projectDir,
    testCommand: args.testCommand,
    outputPath,
  });

  console.log('---');
  console.log(`[tracer-lite] teste encerrado (code=${code}, signal=${signal}); log em ${outputPath}`);
  process.exitCode = code === null ? 1 : code; // transparente para CI
}

main();
