'use strict';

/**
 * patches/timers.js
 *
 * Patched objects: setTimeout, setInterval, setImmediate and the matching
 * clear* functions. They are replaced both on `globalThis` and on the `timers`
 * module (code that calls `require('timers')` after the preload gets the traced
 * version).
 *
 * setInterval keeps its record open, counting each firing in
 * `continuationRuns`, until clearInterval is called or the process ends.
 */

const timers = require('timers');
const recorder = require('../core/recorder');
const { beginTrace, directUserCall } = require('../core/primitives');

const TIMERS = [
  { name: 'setTimeout', repeat: false, hasDelay: true },
  { name: 'setInterval', repeat: true, hasDelay: true },
  { name: 'setImmediate', repeat: false, hasDelay: false },
];
const CLEARS = ['clearTimeout', 'clearInterval', 'clearImmediate'];

function createTracedTimer(original, { name, repeat, hasDelay }) {
  return new Proxy(original, {
    apply(target, thisArg, args) {
      if (typeof args[0] !== 'function') return Reflect.apply(target, thisArg, args);

      // Node schedules timers internally all the time: only direct user calls are traced.
      const trace = beginTrace({
        type: name,
        origin: 'timer',
        accept: directUserCall,
        details: hasDelay ? () => ({ delayMs: Number(args[1]) || 1 }) : undefined,
      });
      if (!trace) return Reflect.apply(target, thisArg, args);

      args[0] = trace.wrapCallback(args[0], { repeat });
      return trace.run(target, thisArg, args); // also tracks the Timeout/Immediate for clear*
    },
  });
}

function createTracedClear(original) {
  return new Proxy(original, {
    apply(target, thisArg, args) {
      const record = recorder.recordOf(args[0]);
      if (record) recorder.finalize(record, { status: 'cancelled' });
      return Reflect.apply(target, thisArg, args);
    },
  });
}

function install() {
  for (const timer of TIMERS) {
    const original = globalThis[timer.name];
    if (typeof original !== 'function') continue;
    const traced = createTracedTimer(original, timer);
    globalThis[timer.name] = traced;
    timers[timer.name] = traced;
  }

  for (const name of CLEARS) {
    const original = globalThis[name];
    if (typeof original !== 'function') continue;
    const traced = createTracedClear(original);
    globalThis[name] = traced;
    timers[name] = traced;
  }
}

module.exports = { name: 'timers', install };
