// import_fs_2.mjs
import fs from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

/*
** Linhas com operações assincronas: 14
** 24 - new Promise OK
** 25 - setTimeout OK
** 35 - queueMicrotask OK
** 48 - await lerDadosComDelay - não pegou, pois os 2 traces que tem o 49, tem os registros do 24 e 25 antes no stack
** 50 - await fs.readFile OK
** 52 - await sleep OK
** 56 - await fetch x3 OK x3
** 59 - await resposta.json OK
** 61 - Promise.resolve().then x2 OK x2
** 65 - await import OK
** 79 - await processarFluxoAssincrono OK
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

  agendarTarefaPrioritaria();

  const resultadoDelay = await lerDadosComDelay(); // [REGISTRAR] Chamada de função async / Await em Promise customizada

  const conteudo = await fs.readFile('./package.json', 'utf-8'); // [REGISTRAR] Operação de I/O de Arquivo assíncrona (fs.readFile)

  await sleep(200); // [REGISTRAR] Timer baseado em Promises (node:timers/promises)

  let resposta;
  for (let i = 0; i < 3; i++) {
    resposta = await fetch('https://jsonplaceholder.typicode.com/todos/1'); // [REGISTRAR x3] Requisição de Rede assíncrona (Fetch API)
  }

  const dados = await resposta.json(); // [REGISTRAR] Leitura/Parsing assíncrono de Body de resposta HTTP (.json())

  Promise.resolve('Fluxo secundário concluído').then((msg) => { // [REGISTRAR x2] Encadeamento assíncrono via método .then()
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
const resultadoFinal = await processarFluxoAssincrono(); // [REGISTRAR] Execução inicial da função async principal via Top-Level Await
console.log('Resultado processado com sucesso:', resultadoFinal);