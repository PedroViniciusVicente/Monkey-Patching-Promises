'use strict';

/**
 * patches/fs-promises.js
 *
 * Patched object: `fs.promises` (identical to `require('fs/promises')`).
 *
 * Every function returns a promise; the Proxy opens a record for the operation
 * and associates it with the returned promise. The record is closed when the
 * promise is observed (`await` or `.then`), see `promise-prototype.js`.
 */

const fsPromises = require('fs').promises;
const { beginTrace, targetDetails } = require('../core/primitives');

const PROMISE_FUNCTIONS = [
  'access', 'appendFile', 'chmod', 'chown', 'copyFile', 'cp', 'lchown', 'link', 'lstat',
  'lutimes', 'mkdir', 'mkdtemp', 'open', 'opendir', 'readdir', 'readFile', 'readlink',
  'realpath', 'rename', 'rm', 'rmdir', 'stat', 'statfs', 'symlink', 'truncate', 'unlink',
  'utimes', 'writeFile',
];

function createTracedFunction(original, name) {
  const type = `fs.promises.${name}`;

  return new Proxy(original, {
    apply(target, thisArg, args) {
      const trace = beginTrace({ type, origin: 'promise-api', details: () => targetDetails(args) });
      if (!trace) return Reflect.apply(target, thisArg, args);
      return trace.runPromiseApi(target, thisArg, args);
    },
  });
}

function install() {
  for (const name of PROMISE_FUNCTIONS) {
    const original = fsPromises[name];
    if (typeof original !== 'function') continue;
    fsPromises[name] = createTracedFunction(original, name);
  }
}

module.exports = { name: 'fs.promises', install };
