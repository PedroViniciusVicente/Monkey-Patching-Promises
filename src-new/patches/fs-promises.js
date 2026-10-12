'use strict';

/**
 * patches/fs-promises.js
 *
 * Objeto patcheado: `fs.promises` (idêntico a `require('fs/promises')`).
 *
 * Cada função devolve uma promise; o wrapper cria o registro da operação e o
 * associa à promise devolvida. O registro é fechado quando a promise é
 * observada (`await` ou `.then`), ver `promise-prototype.js`.
 */

const fsPromises = require('fs').promises;
const { wrapPromiseApi, targetDetails } = require('../core/wrap');

const PROMISE_FUNCTIONS = [
  'access', 'appendFile', 'chmod', 'chown', 'copyFile', 'cp', 'lchown', 'link', 'lstat',
  'lutimes', 'mkdir', 'mkdtemp', 'open', 'opendir', 'readdir', 'readFile', 'readlink',
  'realpath', 'rename', 'rm', 'rmdir', 'stat', 'statfs', 'symlink', 'truncate', 'unlink',
  'utimes', 'writeFile',
];

function install() {
  for (const name of PROMISE_FUNCTIONS) {
    const original = fsPromises[name];
    if (typeof original !== 'function') continue;
    fsPromises[name] = wrapPromiseApi({ original, type: `fs.promises.${name}`, details: targetDetails });
  }
}

module.exports = { name: 'fs.promises', install };
