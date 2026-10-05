'use strict';

const util = require('util');

const MAX_STRING_LENGTH = 2000;
const MAX_INSPECT_LENGTH = 4000;
const MAX_INSPECT_DEPTH = 4;

/**
 * Serializa com segurança um valor arbitrário de JS (valor resolvido ou
 * motivo de rejeição de uma Promise) para algo que:
 *   - NUNCA lança (referências circulares, getters que lançam, BigInt, etc.)
 *   - NUNCA estoura o tamanho do arquivo de log (objetos/strings enormes)
 *
 * Não usamos `JSON.stringify` diretamente no valor porque ele lança em
 * referências circulares, lança em BigInt, e "engole" silenciosamente
 * funções/símbolos/undefined — o que é enganoso ao depurar ("cadê meu
 * valor?"). `util.inspect` lida com tudo isso graciosamente.
 */
function safeSerialize(value) {
  try {
    if (value === undefined) return { type: 'undefined', preview: 'undefined' };
    if (value === null) return { type: 'null', preview: 'null' };

    const jsType = typeof value;

    if (jsType === 'string') {
      return {
        type: 'string',
        preview: truncate(value, MAX_STRING_LENGTH),
        truncated: value.length > MAX_STRING_LENGTH,
        originalLength: value.length,
      };
    }

    if (jsType === 'bigint') {
      return { type: 'bigint', preview: `${value}n` };
    }

    if (jsType === 'function') {
      return { type: 'function', preview: `[Function: ${value.name || 'anonymous'}]` };
    }

    if (jsType === 'symbol') {
      return { type: 'symbol', preview: value.toString() };
    }

    if (value instanceof Error) {
      return {
        type: 'error',
        preview: truncate(`${value.name}: ${value.message}`, MAX_STRING_LENGTH),
        stack: value.stack ? truncate(value.stack, MAX_STRING_LENGTH) : undefined,
      };
    }

    // objetos, arrays, Map, Set, instâncias de classes, números, booleans...
    const inspected = util.inspect(value, {
      depth: MAX_INSPECT_DEPTH,
      maxArrayLength: 50,
      maxStringLength: MAX_STRING_LENGTH,
      breakLength: 120,
      customInspect: false, // evita reentrar em um inspect() definido pelo usuário que pode falhar
    });

    return {
      type: jsType, // 'object' | 'number' | 'boolean'
      preview: truncate(inspected, MAX_INSPECT_LENGTH),
      truncated: inspected.length > MAX_INSPECT_LENGTH,
    };
  } catch (err) {
    // Última linha de defesa: serializar NUNCA pode lançar/travar o
    // processo sob teste.
    return {
      type: 'unserializable',
      preview: `[unserializable value: ${err && err.message}]`,
    };
  }
}

function truncate(str, max) {
  if (typeof str !== 'string') return str;
  return str.length > max ? `${str.slice(0, max)}…[truncated ${str.length - max} chars]` : str;
}

module.exports = { safeSerialize };
