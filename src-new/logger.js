'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Wrapper fino em torno de um stream de escrita para um arquivo JSON Lines
 * (.jsonl) em modo append.
 *
 * Decisões de design:
 *  - Usamos `fs.createWriteStream` (não `fs.appendFileSync` por linha) para
 *    não bloquear o event loop do processo sob teste com um grande volume
 *    de eventos de Promise — regra nº 1 desta ferramenta: nunca deixar o
 *    tracer atrasar ou quebrar os testes que ele está observando.
 *  - Criamos o diretório de destino antecipadamente e abrimos em modo 'a',
 *    então dados já gravados no disco não se perdem mesmo se o processo
 *    (ou o próprio tracer) morrer no meio da execução.
 *  - TODA escrita é protegida por try/catch: uma falha de log jamais pode
 *    lançar para quem chamou (que é código de dentro dos patches de src/patches/ /
 *    recorder — uma exceção não tratada ali SE PROPAGARIA para o
 *    processo sob teste).
 *  - Este módulo deliberadamente NUNCA cria uma `Promise` própria (usamos
 *    apenas callbacks/streams). Isso evita que o próprio tracer rastreie a
 *    si mesmo depois que `Promise` global for substituída pelo Proxy.
 */
// O stream de escrita chama `fs.open/write/close` por dentro. Passamos as
// versões ORIGINAIS (capturadas antes de qualquer patch) para que escrever o
// log nunca gere registros no próprio log.
const ORIGINAL_FS = { open: fs.open, close: fs.close, write: fs.write, writev: fs.writev };

class JsonlLogger {
  constructor(outputPath) {
    this.outputPath = outputPath;
    this._stream = null;
    this._fd = undefined;
    this._ready = false;
    this._buffer = [];
    this._init();
  }

  _init() {
    try {
      fs.mkdirSync(path.dirname(this.outputPath), { recursive: true });
      this._stream = fs.createWriteStream(this.outputPath, { flags: 'a', encoding: 'utf8', fs: ORIGINAL_FS });

      this._stream.on('open', (fd) => {
        this._fd = fd;
        this._ready = true;
        this._flushBuffer();
      });

      this._stream.on('error', (err) => {
        this._ready = false;
        this._safeStderr(`erro no stream de log: ${err && err.message}`);
      });
    } catch (err) {
      this._safeStderr(`falha ao inicializar o logger: ${err && err.message}`);
    }
  }

  _flushBuffer() {
    if (!this._buffer.length) return;
    const pending = this._buffer;
    this._buffer = [];
    pending.forEach((line) => this._writeLine(line));
  }

  write(record) {
    let line;
    try {
      line = JSON.stringify(record);
    } catch (err) {
      this._safeStderr(`falha ao serializar registro: ${err && err.message}`);
      return;
    }

    if (!this._ready || !this._stream) {
      // O stream ainda não terminou de abrir (ou falhou) — bufferizamos em
      // memória para não perder o evento; será liberado em `_flushBuffer`.
      this._buffer.push(line);
      return;
    }
    this._writeLine(line);
  }

  /**
   * Escrita síncrona, usada no fim do processo (handler de 'exit'), quando
   * callbacks assíncronos já não rodam mais.
   */
  writeSync(record) {
    try {
      const line = JSON.stringify(record) + '\n';
      if (this._fd === undefined) this._fd = fs.openSync(this.outputPath, 'a');
      fs.writeSync(this._fd, line);
    } catch (err) {
      this._safeStderr(`erro de escrita síncrona: ${err && err.message}`);
    }
  }

  _writeLine(line) {
    try {
      this._stream.write(line + '\n');
    } catch (err) {
      this._safeStderr(`erro de escrita: ${err && err.message}`);
    }
  }

  /**
   * Hook de durabilidade best-effort, pensado para ser chamado de dentro de
   * um handler de `process.on('exit')`, onde callbacks assíncronos não têm
   * garantia de rodar. Ver README.md → "Limitações conhecidas".
   */
  closeSync() {
    try {
      // Linhas que ainda estavam só em memória (stream não chegou a abrir).
      const pending = this._buffer;
      this._buffer = [];
      if (pending.length) {
        if (this._fd === undefined) this._fd = fs.openSync(this.outputPath, 'a');
        fs.writeSync(this._fd, pending.join('\n') + '\n');
      }
      if (this._fd !== undefined) fs.fsyncSync(this._fd);
    } catch (err) {
      this._safeStderr(`erro no closeSync/fsync: ${err && err.message}`);
    }
  }

  _safeStderr(msg) {
    try {
      process.stderr.write(`[promise-monkey-tracer] ${msg}\n`);
    } catch {
      /* não há mais nada que possamos fazer aqui */
    }
  }
}

module.exports = { JsonlLogger };
