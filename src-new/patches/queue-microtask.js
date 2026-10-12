'use strict';

/**
 * patches/queue-microtask.js
 *
 * Objeto patcheado: `queueMicrotask` global.
 */

const { wrapCallbackApi } = require('../core/wrap');

function install() {
  if (typeof globalThis.queueMicrotask !== 'function') return;
  globalThis.queueMicrotask = wrapCallbackApi({
    original: globalThis.queueMicrotask,
    type: 'queueMicrotask',
    origin: 'microtask',
    callbackIndex: () => 0,
    accept: (callSite) => callSite.directUserCall,
  });
}

module.exports = { name: 'queueMicrotask', install };
