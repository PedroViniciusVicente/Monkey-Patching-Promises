'use strict';

/**
 * patches/queue-microtask.js
 *
 * Patched object: the global `queueMicrotask`.
 */

const { beginTrace, directUserCall } = require('../core/primitives');

function install() {
  if (typeof globalThis.queueMicrotask !== 'function') return;

  globalThis.queueMicrotask = new Proxy(globalThis.queueMicrotask, {
    apply(target, thisArg, args) {
      if (typeof args[0] !== 'function') return Reflect.apply(target, thisArg, args);

      const trace = beginTrace({ type: 'queueMicrotask', origin: 'microtask', accept: directUserCall });
      if (!trace) return Reflect.apply(target, thisArg, args);

      args[0] = trace.wrapCallback(args[0]);
      return trace.run(target, thisArg, args);
    },
  });
}

module.exports = { name: 'queueMicrotask', install };
