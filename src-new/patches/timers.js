'use strict';

/**
 * patches/timers.js
 *
 * Objetos patcheados: setTimeout, setInterval, setImmediate e os respectivos
 * clear*. São substituídos tanto em `globalThis` quanto no módulo `timers`
 * (quem faz `require('timers')` depois do preload recebe a versão rastreada).
 *
 * setInterval mantém o registro aberto, contando cada disparo em
 * `continuationRuns`, até o clearInterval ou o fim do processo.
 */

const timers = require('timers');
const recorder = require('../core/recorder');
const { wrapCallbackApi, copyFunctionMetadata } = require('../core/wrap');

const TIMERS = [
  { name: 'setTimeout', repeat: false, hasDelay: true },
  { name: 'setInterval', repeat: true, hasDelay: true },
  { name: 'setImmediate', repeat: false, hasDelay: false },
];
const CLEARS = ['clearTimeout', 'clearInterval', 'clearImmediate'];

function wrapClear(original) {
  const wrapper = function tracedClear(handle, ...rest) {
    const record = recorder.recordOf(handle);
    if (record) recorder.finalize(record, { status: 'cancelled' });
    return Reflect.apply(original, this, [handle, ...rest]);
  };
  return copyFunctionMetadata(original, wrapper);
}

function install() {
  for (const { name, repeat, hasDelay } of TIMERS) {
    const original = globalThis[name];
    if (typeof original !== 'function') continue;
    const wrapped = wrapCallbackApi({
      original,
      type: name,
      origin: 'timer',
      callbackIndex: () => 0,
      accept: (callSite) => callSite.directUserCall,
      details: hasDelay ? (args) => ({ delayMs: Number(args[1]) || 1 }) : undefined,
      repeat,
    });
    globalThis[name] = wrapped;
    timers[name] = wrapped;
  }

  for (const name of CLEARS) {
    const original = globalThis[name];
    if (typeof original !== 'function') continue;
    const wrapped = wrapClear(original);
    globalThis[name] = wrapped;
    timers[name] = wrapped;
  }
}

module.exports = { name: 'timers', install };
