#!/usr/bin/env node
'use strict';

const path = require('path');
const fs = require('fs');
const { runTracedTestCommand } = require('./child-process-runner');

function parseArgs(argv) {
  const args = { projectDir: null, testCommand: null, output: './logs/promise-trace.jsonl' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--project-dir':
        args.projectDir = argv[++i];
        break;
      case '--test-command':
        args.testCommand = argv[++i];
        break;
      case '--output':
        args.output = argv[++i];
        break;
      case '--help':
      case '-h':
        printUsage();
        process.exit(0);
        break;
      default:
        throw new Error(`Argumento desconhecido: ${arg}`);
    }
  }
  return args;
}

function validateArgs(args) {
  const errors = [];
  if (!args.projectDir) {
    errors.push('--project-dir é obrigatório');
  } else if (!path.isAbsolute(args.projectDir)) {
    errors.push('--project-dir precisa ser um caminho absoluto');
  } else if (!fs.existsSync(args.projectDir)) {
    errors.push(`--project-dir não existe: ${args.projectDir}`);
  }

  if (!args.testCommand) {
    errors.push('--test-command é obrigatório');
  }

  return errors;
}

function printUsage() {
  console.error(`
Uso:
  node cli.js --project-dir <caminho absoluto> --test-command "<comando>" [--output <caminho>]

Exemplo:
  node cli.js \\
    --project-dir "/home/pedroubuntu/Desktop/monkey_patching_projects/projects/flowfuse" \\
    --test-command "npx mocha 'test/unit/forge/routes/api/team_spec.js' --timeout 10000 --node-option=unhandled-rejections=strict -g 'with all instances and their status'" \\
    --output "./logs/promise-trace.jsonl"
`);
}

async function main() {
  const argv = process.argv.slice(2);
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error(`Erro de argumento: ${err.message}`);
    printUsage();
    process.exitCode = 1;
    return;
  }

  const errors = validateArgs(args);
  if (errors.length) {
    console.error('Argumentos inválidos:\n' + errors.map((e) => `  - ${e}`).join('\n'));
    printUsage();
    process.exitCode = 1;
    return;
  }

  const resolvedOutput = path.resolve(args.output);
  fs.mkdirSync(path.dirname(resolvedOutput), { recursive: true });

  console.log('[promise-monkey-tracer] projeto :', args.projectDir);
  console.log('[promise-monkey-tracer] comando :', args.testCommand);
  console.log('[promise-monkey-tracer] output  :', resolvedOutput);
  console.log('---');

  const { code, signal } = await runTracedTestCommand({
    projectDir: args.projectDir,
    testCommand: args.testCommand,
    outputPath: resolvedOutput,
  });

  console.log('---');
  console.log(`[promise-monkey-tracer] processo de teste encerrado (code=${code}, signal=${signal})`);
  console.log(`[promise-monkey-tracer] trace gravado em ${resolvedOutput}`);

  // Propaga o código de saída do próprio comando de teste, para que esta
  // ferramenta seja transparente em pipelines de CI (um teste vermelho deve
  // continuar falhando o pipeline).
  process.exitCode = code === null ? 1 : code;
}

main().catch((err) => {
  console.error('[promise-monkey-tracer] erro fatal:', err);
  process.exitCode = 1;
});
