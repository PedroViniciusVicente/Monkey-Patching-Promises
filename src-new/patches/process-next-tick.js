'use strict';

/**
 * patches/process-next-tick.js
 *
 * Objeto patcheado: `process.nextTick`.
 *
 * O Node chama nextTick o tempo todo por dentro (streams, fs...). Só viram
 * registro as chamadas feitas diretamente por código do usuário.
 */

const { wrapCallbackApi } = require('../core/wrap');

function install() {
  process.nextTick = wrapCallbackApi({
    original: process.nextTick,
    type: 'process.nextTick',
    origin: 'tick',
    callbackIndex: () => 0,
    accept: (callSite) => callSite.directUserCall,
  });
}

module.exports = { name: 'process.nextTick', install };
