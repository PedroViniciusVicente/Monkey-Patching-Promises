// import_fs_2.mjs
import fs from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

/*
** Linhas com operações assincronas: 11
** 24 - new Promise
** 25 - setTimeout
** 35 - queueMicrotask
** 49 - await lerDadosComDelay
** 51 - await fs.readFile
** 53 - await sleep
** 55 - await fetch
** 57 - await resposta.json
** 59 - Promise.resolve().then
** 63 - await import
** 78 - await processarFluxoAssincrono
*/

// ---------------------------------------------------------------------------
// 1. Função base usando Construtor de Promise e Timers Tradicionais
// ---------------------------------------------------------------------------
function lerDadosComDelay() {
  return new Promise((resolve) => { // [REGISTRAR] Criação/Instanciação de uma nova Promise
    setTimeout(() => { // [REGISTRAR] Agendamento de timer via API callback (setTimeout)
      resolve({ status: 'ok', data: [1, 2, 3] });
    }, 100);
  });
}

// ---------------------------------------------------------------------------
// 2. Agendamento em Microtask Queue
// ---------------------------------------------------------------------------
function agendarTarefaPrioritaria() {
  queueMicrotask(() => { // [REGISTRAR] Enfileiramento de Microtask no Event Loop (queueMicrotask)
    console.log('[Microtask] Executada antes da próxima fase do Event Loop');
  });
}

// ---------------------------------------------------------------------------
// 3. Função Principal Assíncrona
// ---------------------------------------------------------------------------
async function processarFluxoAssincrono() {
  console.log('Iniciando análise...');

  // Dispara a microtask
  agendarTarefaPrioritaria();

  const resultadoDelay = await lerDadosComDelay(); // [REGISTRAR] Chamada de função async / Await em Promise customizada

  const conteudo = await fs.readFile('./package.json', 'utf-8'); // [REGISTRAR] Operação de I/O de Arquivo assíncrona (fs.readFile)

  await sleep(200); // [REGISTRAR] Timer baseado em Promises (node:timers/promises)

  const resposta = await fetch('https://jsonplaceholder.typicode.com/todos/1'); // [REGISTRAR] Requisição de Rede assíncrona (Fetch API)

  const dados = await resposta.json(); // [REGISTRAR] Leitura/Parsing assíncrono de Body de resposta HTTP (.json())

  Promise.resolve('Fluxo secundário concluído').then((msg) => { // [REGISTRAR] Encadeamento assíncrono via método .then()
    console.log(`[Then] ${msg}`);
  });

  const moduloPath = await import('node:path'); // [REGISTRAR] Carregamento Dinâmico de Módulo (Dynamic Import)
  const caminhoAbsoluto = moduloPath.resolve('.');

  return {
    resultadoDelay,
    tamanhoPacote: conteudo.length,
    dadosHttp: dados,
    caminhoAbsoluto,
  };
}

// ---------------------------------------------------------------------------
// 4. Execução de Top-Level Await
// ---------------------------------------------------------------------------
try {
  const resultadoFinal = await processarFluxoAssincrono(); // [REGISTRAR] Execução inicial da função async principal via Top-Level Await
  console.log('Resultado processado com sucesso:', resultadoFinal);
} catch (erro) {
  console.error('Erro na execução assíncrona:', erro);
}