'use strict';

const path = require('path');

// Qualquer frame cujo arquivo contenha um destes marcadores é considerado
// "interno ao tracer" e é removido do stack reportado ao usuário, para que
// o stack mostre o código real do projeto/teste, não a maquinaria do Proxy
// ou do async_hooks tracker.
const INTERNAL_MARKERS = [
  `${path.sep}promise-monkey-tracer${path.sep}src${path.sep}`,
  'promise-patcher.js',
  'async-hook-tracker.js',
  'preload.js',
  'stack-utils.js',
];

/**
 * Captura o stack trace no ponto de chamada atual, já filtrando frames
 * internos do próprio tracer.
 *
 * Observação importante: `Error.captureStackTrace(holder, fn)` só omite o
 * frame da própria função `fn` (e o que estiver "acima" dela na V8 stack
 * trace API) — não omite automaticamente quem CHAMOU essa função (ex: o
 * `construct` trap do promise-patcher.js). Por isso ainda filtramos
 * explicitamente por `INTERNAL_MARKERS` depois de capturar.
 */
function captureCreationStack(label) {
  const holder = {};
  const previousLimit = Error.stackTraceLimit;
  try {
    Error.stackTraceLimit = 30;
    Error.captureStackTrace(holder, captureCreationStack);
  } finally {
    Error.stackTraceLimit = previousLimit;
  }

  const rawLines = (holder.stack || '').split('\n').slice(1); // remove a linha "Error"
  const frames = rawLines
    .map(parseFrameLine)
    .filter(Boolean)
    .filter((frame) => !isInternalFrame(frame.file));

  return { label, frames };
}

function isInternalFrame(file) {
  if (!file) return true; // frames nativos/anônimos não são um call site útil
  return INTERNAL_MARKERS.some((marker) => file.includes(marker));
}

function parseFrameLine(line) {
  // Formatos típicos de uma linha de stack da V8:
  //   "    at functionName (/caminho/arquivo.js:10:5)"
  //   "    at /caminho/arquivo.js:10:5"
  //   "    at Object.<anonymous> (/caminho/arquivo.js:10:5)"
  const match = line.match(/at (?:(.*?)\s+\()?(.*):(\d+):(\d+)\)?\s*$/);
  if (!match) return null;
  const [, fnName, file, lineNo, colNo] = match;
  if (!file) return null;
  return {
    functionName: fnName || '<anonymous>',
    file,
    line: Number(lineNo),
    column: Number(colNo),
  };
}

/**
 * Heurística best-effort para "qual arquivo de teste estava em execução"
 * quando esta Promise foi criada: procura, dentro do stack já filtrado, o
 * primeiro frame que está dentro do projeto alvo E parece um arquivo de
 * teste (está em uma pasta test/tests, ou o nome bate com *.spec.js,
 * *_spec.js, *.test.js, *_test.js).
 *
 * Isso é deliberadamente simples: não faz hook no runner do Mocha, só olha
 * o stack de criação que já capturamos de qualquer forma.
 */
function guessTestFile(frames, projectDir) {
  if (!projectDir || !Array.isArray(frames)) return null;
  const normalizedProjectDir = path.resolve(projectDir);

  const testFrame = frames.find((frame) => {
    if (!frame.file || !frame.file.startsWith(normalizedProjectDir)) return false;
    const base = path.basename(frame.file);
    const inTestDir =
      frame.file.includes(`${path.sep}test${path.sep}`) || frame.file.includes(`${path.sep}tests${path.sep}`);
    const specLikeName = /[._](spec|test)\.[cm]?js$/i.test(base);
    return inTestDir || specLikeName;
  });

  return testFrame ? path.relative(normalizedProjectDir, testFrame.file) : null;
}

module.exports = { captureCreationStack, guessTestFile };
