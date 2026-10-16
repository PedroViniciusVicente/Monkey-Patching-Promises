// import_stream.mjs - npm i p-limit
import { createReadStream } from 'node:fs';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createInterface } from 'node:readline/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import pLimit from 'p-limit';

/*
** Linhas com operações assincronas: 10
** 32 - for await...of x3, não OK: x4
** 53 - await pipeline OK
** 66 - await sleep
** 71 - await Promise.all
** 85 - await rl.question
** 94 - await Promise.all
** 104 - await simularPerguntaAssincrona
** 108 - await main
*/

// ---------------------------------------------------------------------------
// 1. Leitura de Stream Linha por Linha com for await...of (node:readline/promises)
// ---------------------------------------------------------------------------
async function lerLinhaPorLinha() {
  const streamArquivo = createReadStream('./package.json');
  const rl = createInterface({
    input: streamArquivo,
    crlfDelay: Infinity,
  });

  const primeirasLinhas = [];
  for await (const linha of rl) { // [REGISTRAR] Iteração assíncrona sobre Readable Stream (for await...of)
    primeirasLinhas.push(linha);
    if (primeirasLinhas.length >= 3) break;
  }
  return primeirasLinhas;
}

// ---------------------------------------------------------------------------
// 2. Encanamento Assíncrono de Streams (node:stream/promises)
// ---------------------------------------------------------------------------
async function processarPipelineStream() {
  const entrada = Readable.from(['dados-1', 'dados-2', 'dados-3']);
  let acumulo = '';

  const saida = new Writable({
    write(chunk, encoding, callback) {
      acumulo += chunk.toString() + ' | ';
      callback();
    },
  });

  await pipeline(entrada, saida); // [REGISTRAR] Processamento e encadeamento assíncrono de Streams (pipeline)
  return acumulo;
}

// ---------------------------------------------------------------------------
// 3. Controle de Concorrência Assíncrona com p-limit
// ---------------------------------------------------------------------------
async function executarComLimiteConcorrencia() {
  const limit = pLimit(2); // Máximo de 2 operações simultâneas
  const itens = [100, 200, 300, 400];

  const tarefas = itens.map((ms, index) => {
    return limit(async () => {
      await sleep(ms); // [REGISTRAR] Pausa/Timer assíncrono dentro de tarefa com concorrência limitada
      return `Item ${index + 1} processado após ${ms}ms`;
    });
  });

  const resultados = await Promise.all(tarefas); // [REGISTRAR] Resolução paralela de Promises com limite ativado
  return resultados;
}

// ---------------------------------------------------------------------------
// 4. Leitura Assíncrona de Prompt/Interface (node:readline/promises)
// ---------------------------------------------------------------------------
async function simularPerguntaAssincrona() {
  const streamEntrada = Readable.from(['Sim\n']);
  const rl = createInterface({
    input: streamEntrada,
    output: process.stdout,
  });

  const resposta = await rl.question('Deseja continuar? '); // [REGISTRAR] Leitura assíncrona de entrada via Readline
  rl.close();
  return resposta;
}

// ---------------------------------------------------------------------------
// Execução do Fluxo Assíncrono Principal
// ---------------------------------------------------------------------------
async function main() {
  const [linhas, resultadoStream, resultadosLimitados] = await Promise.all([ // [REGISTRAR] Agrupamento e execução paralela de Promises (Promise.all)
    lerLinhaPorLinha(),
    processarPipelineStream(),
    executarComLimiteConcorrencia(),
  ]);

  console.log('Primeiras linhas do arquivo:', linhas);
  console.log('Resultado da Stream:', resultadoStream);
  console.log('Tarefas limitadas:', resultadosLimitados);

  const respostaPrompt = await simularPerguntaAssincrona(); // [REGISTRAR] Chamada assíncrona isolada via await
  console.log('Resposta do prompt:', respostaPrompt);
}

await main(); // [REGISTRAR] Top-level await para execução do fluxo principal