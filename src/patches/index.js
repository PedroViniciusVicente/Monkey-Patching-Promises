'use strict';

/**
 * patches/index.js
 *
 * List of all patches and the installer. Each file in this folder corresponds
 * to ONE monkey-patched object and exports `{ name, install(options) }`.
 *
 * To trace a new asynchronous operation (EventEmitter, child_process, dns,
 * crypto...), create a new file here in the same format and add it to the
 * list below. A patch owns its interception logic (usually a Proxy with an
 * `apply` trap) and builds on the helpers of `core/primitives.js`
 * (`beginTrace`, `trace.wrapCallback`, `trace.run`, `trace.runPromiseApi`).
 * `fs.js` (callback API) and `fs-promises.js` (promise API) are the shortest
 * examples to copy from.
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
      process.stderr.write(`[promise-monkey-tracer] failed to install patch "${patch.name}": ${error && error.message}\n`);
    }
  }
  return installed;
}

module.exports = { installAllPatches };
