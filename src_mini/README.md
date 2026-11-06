# promise-monkey-tracer-lite (nível 1)

Protótipo didático: rastreia apenas `new Promise` e `Promise.prototype.then`
(`catch` e `finally` passam por `then` dentro do V8).

## Fluxo, do comando ao log

1. `cli.js` (pai) valida os argumentos, zera o log e chama o runner.
2. `child-process-runner.js` (pai) faz `spawn` do comando de teste com
   `NODE_OPTIONS=--require preload.js` e `PROMISE_TRACER_OUTPUT=<log>`.
3. `preload.js` (filho) carrega `tracer.js` (captura os originais), configura a saída,
   instala os patches e registra `flushPending` no `exit`.
4. `patch-promise.js`: Proxy em `globalThis.Promise` → registro "constructor".
5. `patch-promise-prototype.js`: sobrescreve `then` → registro "derived".
6. `tracer.js`: `begin` → `settle` → uma linha JSON por registro (ordem de fechamento).
7. No `exit`, o que ficou aberto é gravado como `pending-at-exit`.

## Regras de triggerAsyncId
- dentro do executor de `new Promise` → id dessa promise
- dentro de um callback de `then` → id da promise derivada
- promise derivada → id da promise pai (se rastreada)
- qualquer outro caso → 1 (raiz)

## Uso
    node src/cli.js --project-dir /abs/projeto --test-command "npx mocha test/x.js" --output ./logs/trace.jsonl

## Campo `stack`
Cada linha do log traz `stack`, no mesmo formato da ferramenta original: array de
`{functionName, file, line, column}` (frame mais interno primeiro, até 30 frames).
Frames do tracer e frames sem arquivo são removidos; frames `node:` são mantidos.

Uma chamada só é rastreada se algum frame síncrono não for do Node (`userInitiated` da original).
Diferença deliberada: frames de `node_modules` também não contam para essa decisão
(mas continuam aparecendo na stack gravada). `PROMISE_TRACER_INCLUDE_NODE_MODULES=1` desliga esse filtro.

## Fora do escopo
`await`, combinadores, timers, nextTick, queueMicrotask, fs e fs.promises.

```bash
node src_mini/cli.js \
    --project-dir "$(pwd)/projects/micro-benchmarks/ESModules_scripts/" \
    --test-command "node import_fs.mjs" \
    --output "./logs-src-mini-november-10/import_fs-trace_com_await.jsonl"
```

```bash
node src_mini/cli.js \
    --project-dir "$(pwd)/projects/micro-benchmarks/ESModules_scripts/" \
    --test-command "node import_fs_2.mjs" \
    --output "./logs-src-mini-november-10/import_fs_2-trace.jsonl"
```

```bash
node src_mini/cli.js \
  --project-dir "$(pwd)/projects/micro-benchmarks/ESModules_scripts/" \
  --test-command "node import_crypto.mjs" \
  --output "./logs-src-mini-november-10/import_crypto-trace.jsonl"
```

```bash
node src_mini/cli.js \
  --project-dir "$(pwd)/projects/micro-benchmarks/ESModules_scripts/" \
  --test-command "node import_sqlite.mjs" \
  --output "./logs-src-mini-november-10/import_sqlite-trace.jsonl"
```

```bash
node src_mini/cli.js \
  --project-dir "$(pwd)/projects/micro-benchmarks/ESModules_scripts/" \
  --test-command "node import_bcrypt.mjs" \
  --output "./logs-src-mini-november-10/import_bcrypt-trace.jsonl"
```

```bash
node src_mini/cli.js \
  --project-dir "$(pwd)/projects/micro-benchmarks/ESModules_scripts/" \
  --test-command "node import_stream.mjs" \
  --output "./logs-src-mini-november-10/import_stream-trace.jsonl"
```