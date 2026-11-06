'use strict';

/**
 * tracer.js — estado e ciclo de vida dos registros (roda no processo FILHO)
 * ---------------------------------------------------------------------------
 * Aqui mora tudo o que, na ferramenta completa, está espalhado em
 * intrinsics.js, ids.js, context.js, recorder.js, logger.js, callsite.js,
 * stack-utils.js e safe-serializer.js.
 *
 * Um REGISTRO representa uma promise rastreada. Ciclo de vida:
 *
 *   begin()  → registro nasce com status "pending" e entra em openRecords
 *   settle() → status muda uma única vez, o registro sai de openRecords
 *              e vira UMA linha JSON no arquivo de log
 *   flushPending() → no exit do processo, fecha o que sobrou
 *                    como "pending-at-exit"
 *
 * Consequência: a ordem das linhas no log é a ordem de FECHAMENTO,
 * não a de criação.
 */

const fs = require('fs');
const path = require('path');
const util = require('util');

// ---------------------------------------------------------------------------
// 1) ORIGINAIS — guardados antes de qualquer patch (preload.js só instala
//    os patches depois de carregar este arquivo).
// ---------------------------------------------------------------------------
const RealPromise = Promise;                       // construtor original
const originalThen = Promise.prototype.then;       // será sobrescrito em patch-promise-prototype.js
const isNativePromise = util.types.isPromise;      // true só para promises do V8; não executa código do objeto

// ---------------------------------------------------------------------------
// 2) ESTADO
// ---------------------------------------------------------------------------
const ROOT_ID = 1;           // "contexto raiz": nada rastreado está executando
let nextId = 2;              // próximo asyncId
let currentId = ROOT_ID;     // quem está executando AGORA (vira o triggerAsyncId)
let outputPath = null;

const recordByPromise = new WeakMap(); // promise → registro (WeakMap: não impede o GC)
const openRecords = new Set();         // registros ainda "pending"

const includeNodeModules = process.env.PROMISE_TRACER_INCLUDE_NODE_MODULES === '1';

function configure(options) {
  outputPath = options.outputPath;
}

// ---------------------------------------------------------------------------
// 3) STACK DE CRIAÇÃO — "onde no código isso aconteceu?"
//    Mesmo formato da ferramenta original: array de frames
//    { functionName, file, line, column }, do frame mais interno para o mais
//    externo. Frames do próprio tracer e frames sem arquivo (nativos, como
//    "new Promise (<anonymous>)") são removidos. Frames do Node ("node:...")
//    são MANTIDOS, porque mostram quando uma chamada veio de dentro do Node.
// ---------------------------------------------------------------------------
const TRACER_SRC_DIR = __dirname + path.sep;
const STACK_LIMIT = 30;

function captureStack() {
  const holder = {};
  const previousLimit = Error.stackTraceLimit;
  try {
    Error.stackTraceLimit = STACK_LIMIT;
    // O 2º argumento omite esta função (e o que ela chamou) do stack.
    Error.captureStackTrace(holder, captureStack);
  } finally {
    Error.stackTraceLimit = previousLimit;
  }

  return (holder.stack || '')
    .split('\n')
    .slice(1) // remove a linha "Error"
    .map(parseFrameLine)
    .filter(Boolean)
    .filter((frame) => !frame.file.startsWith(TRACER_SRC_DIR));
}

function parseFrameLine(line) {
  // Formatos da V8:
  //   "    at functionName (/caminho/arquivo.js:10:5)"
  //   "    at /caminho/arquivo.js:10:5"
  const match = line.match(/at (?:(.*?)\s+\()?(.*):(\d+):(\d+)\)?\s*$/);
  if (!match || !match[2]) return null;
  return {
    functionName: match[1] || '<anonymous>',
    file: match[2],
    line: Number(match[3]),
    column: Number(match[4]),
  };
}

// Decide se esta chamada deve ser rastreada: precisa existir algum frame
// SÍNCRONO que não seja do Node (equivale ao `userInitiated` da original).
// Isso descarta as promises que o próprio Node cria por dentro.
// Diferença deliberada: por padrão frames de node_modules também não contam
// (senão o Mocha e outras libs encheriam o log); a stack gravada, porém,
// continua completa. PROMISE_TRACER_INCLUDE_NODE_MODULES=1 desliga esse filtro.
function isUserInitiated(frames) {
  return frames
    .filter((frame) => !frame.functionName.startsWith('async ')) // frames "async" não são síncronos reais
    .some((frame) => !frame.file.startsWith('node:') && (includeNodeModules || !frame.file.includes('/node_modules/')));
}

// ---------------------------------------------------------------------------
// 4) CONTEXTO — "quem está executando agora?"
//    Dentro de runInContext(id, fn) o currentId vale id. Qualquer registro
//    criado enquanto fn roda recebe esse id como triggerAsyncId.
// ---------------------------------------------------------------------------
function runInContext(id, fn, thisArg, args) {
  const previous = currentId;
  currentId = id;
  try {
    return Reflect.apply(fn, thisArg, args);
  } finally {
    currentId = previous;
  }
}

// ---------------------------------------------------------------------------
// 5) CICLO DE VIDA DO REGISTRO
// ---------------------------------------------------------------------------
function begin({ type, origin, triggerAsyncId }) {
  const stack = captureStack();
  if (!isUserInitiated(stack)) return null;

  const record = {
    pid: process.pid,
    asyncId: nextId++,
    triggerAsyncId: triggerAsyncId !== undefined ? triggerAsyncId : currentId,
    type,
    origin,
    status: 'pending',
    createdAt: Date.now(),
    stack,
  };
  openRecords.add(record);
  return record;
}

function track(promise, record) {
  recordByPromise.set(promise, record);
}

function recordOf(promise) {
  return recordByPromise.get(promise);
}

// Fecha o registro (só a primeira chamada vale) e grava a linha no log.
function settle(record, status, detail = {}) {
  if (record.status !== 'pending') return;
  record.status = status;
  record.settledAt = Date.now();
  if ('value' in detail) record.value = serialize(detail.value);
  if ('reason' in detail) record.reason = serialize(detail.reason);
  openRecords.delete(record);
  write(record);
}

// Resolver com outra promise = "adopted" (o destino real depende dela).
function settleWithValue(record, value) {
  if (isNativePromise(value)) settle(record, 'adopted');
  else settle(record, 'fulfilled', { value });
}

function flushPending() {
  for (const record of [...openRecords]) settle(record, 'pending-at-exit');
}

// ---------------------------------------------------------------------------
// 6) SAÍDA — uma linha JSON por registro, escrita de forma síncrona.
//    appendFileSync não cria promises, então o tracer nunca se rastreia.
// ---------------------------------------------------------------------------
function write(record) {
  if (!outputPath) return;
  fs.appendFileSync(outputPath, JSON.stringify(record) + '\n');
}

function serialize(value) {
  try {
    const preview = util.inspect(value, { depth: 2, breakLength: Infinity, maxStringLength: 200, maxArrayLength: 10 });
    return { type: typeof value, preview: preview.slice(0, 300) };
  } catch {
    return { type: typeof value, preview: '[não serializável]' };
  }
}

module.exports = {
  RealPromise,
  originalThen,
  isNativePromise,
  configure,
  begin,
  track,
  recordOf,
  runInContext,
  settle,
  settleWithValue,
  flushPending,
};
