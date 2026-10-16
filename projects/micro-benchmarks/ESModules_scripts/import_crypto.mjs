// import_crypto.mjs - npm i axios
import crypto from 'node:crypto';
import child_process from 'node:child_process';
import { promisify } from 'node:util';
import { EventEmitter, once } from 'node:events';
import axios from 'axios';

const randomBytes = promisify(crypto.randomBytes);
const pbkdf2 = promisify(crypto.pbkdf2);
const exec = promisify(child_process.exec);
const canalNotificacoes = new EventEmitter();

/*
** Linhas com operações assincronas: 9
** 30 - await randomBytes
** 32 - await pbkdf2
** 40 - await exec
** 48 - await setTimeout
** 51 - await once
** 59 - await axios.get
** 69 - await Promise.all
** 79 - await buscarDadosAxios
** 83 - await main
*/

// ---------------------------------------------------------------------------
// 1. Processamento Criptográfico Assíncrono (CPU-Bound delegado ao libuv)
// ---------------------------------------------------------------------------
async function gerarHashSenha(senha) {
  const salt = await randomBytes(16); // [REGISTRAR] Operação de geração de bytes aleatórios da ThreadPool (Crypto)

  const hash = await pbkdf2(senha, salt, 100000, 64, 'sha512'); // [REGISTRAR] Operação de hashing pesado assíncrono (PBKDF2)
  return hash.toString('hex');
}

// ---------------------------------------------------------------------------
// 2. Comando do Sistema Operacional (Child Process)
// ---------------------------------------------------------------------------
async function obterVersaoSistema() {
  const { stdout } = await exec('node -v'); // [REGISTRAR] Criação e execução assíncrona de subprocesso no SO (exec)
  return stdout.trim();
}

// ---------------------------------------------------------------------------
// 3. Captura de Eventos Promisificada
// ---------------------------------------------------------------------------
async function aguardarEventoCustomizado() {
  setTimeout(() => { // [REGISTRAR] Agendamento de timer
    canalNotificacoes.emit('pronto', { mensagem: 'Serviço inicializado' });
  }, 50);
  const [dadosEvento] = await once(canalNotificacoes, 'pronto'); // [REGISTRAR] Promisificação de escuta de evento (events.once)
  return dadosEvento;
}

// ---------------------------------------------------------------------------
// 4. Chamada de API via Biblioteca de Terceiros (Axios)
// ---------------------------------------------------------------------------
async function buscarDadosAxios() {
  const resposta = await axios.get('https://httpbin.org/get', { // [REGISTRAR] Requisição HTTP de biblioteca externa (axios.get)
    timeout: 3000,
  });
  return resposta.data;
}

// ---------------------------------------------------------------------------
// Execução do Fluxo Assíncrono Principal
// ---------------------------------------------------------------------------
async function main() {
  const [hash, versaoNode, dadosEvento] = await Promise.all([ // [REGISTRAR] Agrupamento e execução paralela de Promises (Promise.all)
    gerarHashSenha('MinhaSenhaSuperSegura123!'),
    obterVersaoSistema(),
    aguardarEventoCustomizado(),
  ]);

  console.log('Hash gerado:', hash.substring(0, 20) + '...');
  console.log('Versão do Node:', versaoNode);
  console.log('Evento recebido:', dadosEvento.mensagem);

  const dadosAxios = await buscarDadosAxios(); // [REGISTRAR] Chamada assíncrona isolada via await
  console.log('IP de Origem (via Axios):', dadosAxios.origin);
}

await main(); // [REGISTRAR] Top-level await para execução do fluxo principal
