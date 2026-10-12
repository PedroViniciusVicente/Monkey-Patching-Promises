'use strict';

/**
 * patches/fs.js
 *
 * Objeto patcheado: o módulo `fs` (API de callbacks: fs.read, fs.readFile,
 * fs.open, fs.write, fs.stat...). A API de promises fica em `fs-promises.js`.
 *
 * Cada função da tabela abaixo é substituída por um wrapper que cria um
 * registro (asyncId + triggerAsyncId) e roda o callback do usuário no contexto
 * desse registro. Para adicionar outra função de fs, basta incluí-la na lista.
 */

const fs = require('fs');
const { wrapCallbackApi, targetDetails } = require('../core/wrap');

const CALLBACK_FUNCTIONS = [
  'access', 'appendFile', 'chmod', 'chown', 'close', 'copyFile', 'cp', 'fchmod', 'fchown',
  'fdatasync', 'fstat', 'fsync', 'ftruncate', 'futimes', 'lchown', 'link', 'lstat', 'lutimes',
  'mkdir', 'mkdtemp', 'open', 'opendir', 'read', 'readdir', 'readFile', 'readlink', 'readv',
  'realpath', 'rename', 'rm', 'rmdir', 'stat', 'statfs', 'symlink', 'truncate', 'unlink',
  'utimes', 'write', 'writeFile', 'writev',
];

function install() {
  for (const name of CALLBACK_FUNCTIONS) {
    const original = fs[name];
    if (typeof original !== 'function') continue;
    fs[name] = wrapCallbackApi({
      original,
      type: `fs.${name}`,
      origin: 'callback-api',
      callbackIndex: (args) => args.length - 1, // o callback é sempre o último argumento
      accept: (callSite) => callSite.userInitiated,
      details: targetDetails,
      nodeStyleErrors: true,
    });
  }
}

module.exports = { name: 'fs', install };
