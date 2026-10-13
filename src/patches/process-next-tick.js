'use strict';

/**
 * patches/process-next-tick.js
 *
 * Patched object: `process.nextTick`.
 *
 * Node calls nextTick all the time internally (streams, fs...). Only calls made
 * directly by user code become records.
 */

const { beginTrace, directUserCall } = require('../core/primitives');

function install() {
  process.nextTick = new Proxy(process.nextTick, {
    apply(target, thisArg, args) {
      if (typeof args[0] !== 'function') return Reflect.apply(target, thisArg, args);

      const trace = beginTrace({ type: 'process.nextTick', origin: 'tick', accept: directUserCall });
      if (!trace) return Reflect.apply(target, thisArg, args);

      args[0] = trace.wrapCallback(args[0]);
      return trace.run(target, thisArg, args);
    },
  });
}

module.exports = { name: 'process.nextTick', install };
