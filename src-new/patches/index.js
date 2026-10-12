'use strict';

/**
 * patches/index.js
 *
 * Lista de todos os patches e instalador. Cada arquivo desta pasta corresponde
 * a UM objeto monkey-patched e exporta `{ name, install(options) }`.
 *
 * Para rastrear uma nova operação assíncrona (EventEmitter, child_process,
 * dns, crypto...), crie um arquivo novo aqui no mesmo formato e acrescente-o
 * à lista abaixo.
 */

const PATCHES = [
  require('./promise'),
  require('./promise-prototype'),
  require('./fs'),
  require('./fs-promises'),
  require('./timers'),
  require('./process-next-tick'),
  require('./queue-microtask'),
];

function installAllPatches(options = {}) {
  const installed = [];
  for (const patch of PATCHES) {
    try {
      patch.install(options);
      installed.push(patch.name);
    } catch (error) {
      process.stderr.write(`[promise-monkey-tracer] falha ao instalar o patch "${patch.name}": ${error && error.message}\n`);
    }
  }
  return installed;
}

module.exports = { installAllPatches };
