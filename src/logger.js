'use strict';

const fs = require('fs');
const path = require('path');

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
      this._stream = fs.createWriteStream(this.outputPath, { flags: 'a', encoding: 'utf8' });

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
