// import_bcrypt.mjs - npm i node-fetch bcrypt
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:dns/promises';
import { setTimeout } from 'node:timers/promises';
import fetch from 'node-fetch';
import bcrypt from 'bcrypt';

/*
** Linhas com operações assincronas: 12
** 29 - await writeFile
** 30 - await readFile
** 31 - await unlink
** 39 - await setTimeout
** 40 - await resolve
** 49 - await bcrypt.hash
** 50 - await bcrypt.compare
** 58 - await fetch
** 59 - await resposta.json
** 67 - await Promise.all
** 77 - await buscarDadosFetch
** 81 - await main
*/

// ---------------------------------------------------------------------------
// 1. Operações de Sistema de Arquivos Assíncronas (node:fs/promises)
// ---------------------------------------------------------------------------
async function operacoesArquivo() {
  const caminho = './temp_teste.txt';
  await writeFile(caminho, 'Conteúdo de teste para análise dinâmica'); // [REGISTRAR] Escrita assíncrona no sistema de arquivos
  const conteudo = await readFile(caminho, 'utf-8'); // [REGISTRAR] Leitura assíncrona do sistema de arquivos
  await unlink(caminho); // [REGISTRAR] Remoção assíncrona de arquivo
  return conteudo;
}

// ---------------------------------------------------------------------------
// 2. Resolução de Rede e Timers Promisificados (node:dns/promises e node:timers/promises)
// ---------------------------------------------------------------------------
async function resolverRedeETimer() {
  await setTimeout(100); // [REGISTRAR] Timer/Pausa assíncrona (node:timers/promises)
  const ips = await resolve('google.com'); // [REGISTRAR] Resolução DNS assíncrona (node:dns/promises)
  return ips;
}

// ---------------------------------------------------------------------------
// 3. Hashing de Senhas Assíncrono via Pacote Externo (bcrypt)
// ---------------------------------------------------------------------------
async function processarBcrypt(texto) {
  const saltRounds = 10;
  const hash = await bcrypt.hash(texto, saltRounds); // [REGISTRAR] Hashing assíncrono de senha (bcrypt)
  const comparacao = await bcrypt.compare(texto, hash); // [REGISTRAR] Comparação/Validação assíncrona de hash (bcrypt)
  return { hash, comparacao };
}

// ---------------------------------------------------------------------------
// 4. Requisição HTTP via Pacote Externo (node-fetch)
// ---------------------------------------------------------------------------
async function buscarDadosFetch() {
  const resposta = await fetch('https://jsonplaceholder.typicode.com/todos/1'); // [REGISTRAR] Requisição HTTP assíncrona (node-fetch)
  const json = await resposta.json(); // [REGISTRAR] Parsing assíncrono do corpo JSON
  return json;
}

// ---------------------------------------------------------------------------
// Execução do Fluxo Assíncrono Principal
// ---------------------------------------------------------------------------
async function main() {
  const [conteudo, ips, resultadoBcrypt] = await Promise.all([ // [REGISTRAR] Agrupamento e execução paralela de Promises (Promise.all)
    operacoesArquivo(),
    resolverRedeETimer(),
    processarBcrypt('SenhaSegura456!'),
  ]);

  console.log('Conteúdo do arquivo:', conteudo);
  console.log('IPs resolvidos:', ips);
  console.log('Hash gerado pelo Bcrypt:', resultadoBcrypt.hash);

  const dadosFetch = await buscarDadosFetch(); // [REGISTRAR] Chamada assíncrona isolada via await
  console.log('Dados recebidos (via node-fetch):', dadosFetch);
}

await main(); // [REGISTRAR] Top-level await para execução do fluxo principal