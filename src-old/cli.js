#!/usr/bin/env node
'use strict';

/**
 * cli.js
 *
 * Runs a test command (Mocha, Jest, etc.) with promise-tracker.js
 * preloaded via NODE_OPTIONS="--require ...", inside a given project directory.
 *
 * Usage:
 *   node cli.js --cmd "<test command>" --path "<project path>" [--out <file>]
 *
 * Example:
 *   node cli.js \
 *     --cmd "npx mocha 'test/unit/forge/routes/api/team_spec.js' --timeout 10000 --node-option=unhandled-rejections=strict -g 'com todas as instâncias e seus status'" \
 *     --path "/home/pedroubuntu/Desktop/monkey_patching_projects/projects/flowfuse"
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { parseArgs } = require('util');

function printUsageAndExit(message) {
  if (message) console.error(`[promise-tracker] ${message}\n`);
  console.error(
    'Usage: promise-tracker --cmd "<test command>" --path "<project path>" [--out <log-file>]'
  );
  process.exit(1);
}

let values;
try {
  ({ values } = parseArgs({
    options: {
      cmd: { type: 'string', short: 'c' },
      path: { type: 'string', short: 'p' },
      out: { type: 'string', short: 'o', default: 'promise-trace.ndjson' },
    },
  }));
} catch (err) {
  printUsageAndExit(err.message);
}

if (!values.cmd || !values.path) {
  printUsageAndExit('Both --cmd and --path are required.');
}

const projectPath = path.resolve(values.path);
if (!fs.existsSync(projectPath) || !fs.statSync(projectPath).isDirectory()) {
  printUsageAndExit(`--path does not point to an existing directory: ${projectPath}`);
}

const logFile = path.resolve(values.out);
const hookFile = path.join(__dirname, 'promise-tracker.js');

// Preload the tracker ahead of whatever NODE_OPTIONS the user already had set.
const existingNodeOptions = process.env.NODE_OPTIONS || '';
const nodeOptions = `--require "${hookFile}" ${existingNodeOptions}`.trim();

console.log(`[promise-tracker] command : ${values.cmd}`);
console.log(`[promise-tracker] project : ${projectPath}`);
console.log(`[promise-tracker] log     : ${logFile}`);
console.log('[promise-tracker] starting instrumented test run...\n');

const child = spawn(values.cmd, {
  cwd: projectPath,
  shell: true,
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_OPTIONS: nodeOptions,
    PROMISE_TRACKER_LOG_FILE: logFile,
  },
});

child.on('error', (err) => {
  console.error(`[promise-tracker] failed to start test command: ${err.message}`);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  console.log(`\n[promise-tracker] test process finished (code=${code}, signal=${signal})`);
  console.log(`[promise-tracker] trace log : ${logFile}`);
  console.log(`[promise-tracker] summary   : ${logFile.replace(/\.ndjson$/i, '')}.summary.json`);
  process.exit(code === null ? 1 : code);
});