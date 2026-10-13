'use strict';

/**
 * patches/fs.js
 *
 * Patched object: the `fs` module (callback API: fs.read, fs.readFile,
 * fs.open, fs.write, fs.stat...). The promise API lives in `fs-promises.js`.
 *
 * Each function in the list below is replaced by a Proxy whose `apply` trap
 * opens a record (asyncId + triggerAsyncId) and runs the user's callback in the
 * context of that record. To trace another fs function, add it to the list.
 */

const fs = require('fs');
const { beginTrace, targetDetails } = require('../core/primitives');

const CALLBACK_FUNCTIONS = [
  'access', 'appendFile', 'chmod', 'chown', 'close', 'copyFile', 'cp', 'fchmod', 'fchown',
  'fdatasync', 'fstat', 'fsync', 'ftruncate', 'futimes', 'lchown', 'link', 'lstat', 'lutimes',
  'mkdir', 'mkdtemp', 'open', 'opendir', 'read', 'readdir', 'readFile', 'readlink', 'readv',
  'realpath', 'rename', 'rm', 'rmdir', 'stat', 'statfs', 'symlink', 'truncate', 'unlink',
  'utimes', 'write', 'writeFile', 'writev',
];

function createTracedFunction(original, name) {
  const type = `fs.${name}`;

  return new Proxy(original, {
    apply(target, thisArg, args) {
      const callbackIndex = args.length - 1; // the callback is always the last argument
      if (callbackIndex < 0 || typeof args[callbackIndex] !== 'function') {
        return Reflect.apply(target, thisArg, args);
      }

      const trace = beginTrace({ type, origin: 'callback-api', details: () => targetDetails(args) });
      if (!trace) return Reflect.apply(target, thisArg, args);

      // fs callbacks are node-style: an Error as first argument closes the record as rejected.
      args[callbackIndex] = trace.wrapCallback(args[callbackIndex], { nodeStyleErrors: true });
      return trace.run(target, thisArg, args);
    },
  });
}

function install() {
  for (const name of CALLBACK_FUNCTIONS) {
    const original = fs[name];
    if (typeof original !== 'function') continue;
    fs[name] = createTracedFunction(original, name);
  }
}

module.exports = { name: 'fs', install };
