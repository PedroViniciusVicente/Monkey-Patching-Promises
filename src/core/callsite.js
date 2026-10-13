'use strict';

/**
 * callsite.js
 *
 * Captura o call site de uma chamada interceptada e o classifica:
 * quem chamou foi o código do usuário (ou de libs como o Mocha) ou o próprio
 * Node, por dentro de suas implementações?
 *
 * Isso evita que as dezenas de promises/ticks/chamadas de fs que o Node cria
 * internamente virem ruído no log.
 */

const { captureCreationStack } = require('../stack-utils');

const isNodeBuiltinFile = (file) => typeof file === 'string' && file.startsWith('node:');

// O V8 acrescenta frames "async fn" (cadeia de awaits) no fim do stack. Eles
// não são frames síncronos reais, então não servem para classificar a chamada.
const isSyncFrame = (frame) => !frame.functionName.startsWith('async ');

function captureCallSite() {
  const { frames } = captureCreationStack();
  const syncFrames = frames.filter(isSyncFrame);
  return {
    frames,
    // Algum frame síncrono fora do Node => o código do usuário iniciou a chamada
    // (mesmo que via util.promisify, streams etc.).
    userInitiated: syncFrames.some((frame) => !isNodeBuiltinFile(frame.file)),
    // O frame mais interno é código do usuário => chamada direta. Usado para
    // process.nextTick/queueMicrotask, que o Node chama o tempo todo por dentro.
    directUserCall: syncFrames.length > 0 && !isNodeBuiltinFile(syncFrames[0].file),
  };
}

module.exports = { captureCallSite, isNodeBuiltinFile, isSyncFrame };
