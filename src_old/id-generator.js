'use strict';

// Contador monotônico simples. Não precisa ser globalmente único fora deste
// processo (cada processo filho instrumentado escreve no seu próprio
// arquivo/linha, e o asyncId do async_hooks já é único por processo) — só
// precisamos de algo legível e sem colisão dentro de uma mesma execução.
let counter = 0;

function nextInternalId(prefix = 'p') {
  counter += 1;
  return `${prefix}_${process.pid}_${counter}`;
}

module.exports = { nextInternalId };
