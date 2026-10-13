'use strict';

/**
 * recorder.js
 *
 * Ciclo de vida dos registros do trace: `begin` (cria, com asyncId e
 * triggerAsyncId), `finalize` (fecha e escreve uma linha JSONL) e
 * `flushPending` (fecha no fim do processo o que nunca terminou).
 *
 * Também mantém o mapa objeto -> registro (promises, timers) que os patches
 * usam para ligar uma promise ao registro da operação que a produziu.
 */

const { safeSerialize } = require('../safe-serializer');
const { guessTestFile } = require('../stack-utils');
const { nextAsyncId, internalIdFor } = require('./ids');
const context = require('./context');

let logger = null;
let projectDir = null;
const liveRecords = new Set();
const recordByObject = new WeakMap();

class TraceRecord {
  #createdHr = process.hrtime.bigint();
  #createdAt = new Date().toISOString();
  #settledAt = null;
  #durationMs = null;
  #open = true;
  #extra;

  constructor({ asyncId, triggerAsyncId, origin, type, combinatorMethod, frames, testFile, details }) {
    this.asyncId = asyncId;
    this.triggerAsyncId = triggerAsyncId;
    this.origin = origin;
    this.type = type;
    this.combinatorMethod = combinatorMethod;
    this.status = 'pending';
    this.continuationRuns = 0;
    this.testFile = testFile;
    this.frames = frames;
    this.#extra = { ...details };
  }

  get isOpen() {
    return this.#open;
  }

  /** Conta uma execução de código "dentro" deste recurso (callback, continuação...). */
  noteRun() {
    this.continuationRuns += 1;
  }

  settle({ status, value, captureValue, reason, captureReason, details }) {
    this.#open = false;
    this.status = status;
    this.#settledAt = new Date().toISOString();
    this.#durationMs = Number(process.hrtime.bigint() - this.#createdHr) / 1e6;
    if (details) Object.assign(this.#extra, details);
    if (captureValue) this.#extra.value = safeSerialize(value);
    if (captureReason) this.#extra.reason = safeSerialize(reason);
  }

  /** Forma final da linha JSONL (mesmos campos do tracer anterior + type/pid/extras). */
  toJSON() {
    return {
      internalId: internalIdFor(this.asyncId),
      pid: process.pid,
      asyncId: this.asyncId,
      triggerAsyncId: this.triggerAsyncId,
      origin: this.origin,
      type: this.type,
      combinatorMethod: this.combinatorMethod,
      status: this.status,
      createdAt: this.#createdAt,
      settledAt: this.#settledAt,
      durationMs: this.#durationMs,
      continuationRuns: this.continuationRuns,
      testFile: this.testFile,
      ...this.#extra,
      stack: this.frames,
    };
  }
}

function configure(options) {
  logger = options.logger;
  projectDir = options.projectDir;
}

/** Cria um registro aberto. `triggerAsyncId` quem chama decide (contexto atual, promise pai...). */
function begin({ type, origin, triggerAsyncId, callSite, combinatorMethod = null, details }) {
  const frames = callSite ? callSite.frames : [];
  const record = new TraceRecord({
    asyncId: nextAsyncId(),
    triggerAsyncId,
    origin,
    type,
    combinatorMethod,
    frames,
    testFile: guessTestFile(frames, projectDir),
    details,
  });
  liveRecords.add(record);
  return record;
}

/** Fecha o registro (uma única vez) e escreve a linha no log. */
function finalize(record, outcome, { sync = false } = {}) {
  if (!record || !record.isOpen) return;
  record.settle(outcome);
  liveRecords.delete(record);
  write(record, sync);
}

function write(record, sync) {
  if (!logger) return;
  // O próprio ato de logar não pode gerar registros.
  context.withTracingSuppressed(() => (sync ? logger.writeSync(record.toJSON()) : logger.write(record.toJSON())), undefined, []);
}

/** No fim do processo, fecha tudo que ainda estava aberto. */
function flushPending(reason) {
  for (const record of [...liveRecords]) {
    finalize(record, { status: reason }, { sync: true });
  }
}

const track = (object, record) => recordByObject.set(object, record);
const recordOf = (object) => recordByObject.get(object);

module.exports = { configure, begin, finalize, flushPending, track, recordOf };
