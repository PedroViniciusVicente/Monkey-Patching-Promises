# promise-monkey-tracer (protótipo)

CLI que intercepta e loga em **JSON Lines** as operações assíncronas executadas
durante uma suíte de testes **Mocha** (CommonJS) de outro projeto Node.js —
Promises (`new Promise`, `then`, `await`, combinadores), `fs` (callbacks e
`fs.promises`), timers, `process.nextTick` e `queueMicrotask` — sem alterar o
código-fonte do projeto testado.

> **Versão 0.2 — captura 100% por monkey patching.** Esta versão **não usa
> `async_hooks`**. Os campos `asyncId` e `triggerAsyncId` são gerados pelo
> próprio tracer (ver "Arquitetura"). A versão 0.1 registrava também as dezenas
> de Promises internas do Node por trás de cada chamada (um `fs.readFile`
> gerava ~16 linhas); esta registra apenas as operações que o código do
> projeto/teste dispara (um `fs.promises.readFile` gera 1 linha).

> **Escopo:** CommonJS + Mocha + Node.js LTS atual (18/20/22). Sem suporte a
> ESM, Jest ou detecção automática de projeto ainda — ver "Pontos de extensão".

Testado de ponta a ponta com Node 22 + Mocha 10.

## Instalação

```bash
cd promise-monkey-tracer
npm install   # não há dependências externas neste protótipo - só confirma o ambiente
```

Não precisa instalar nada dentro do projeto alvo. O tracer é 100% externo,
injetado no processo filho no momento em que o comando de teste roda.

## Uso

```bash
node src/cli.js \
  --project-dir "/caminho/absoluto/para/seu/projeto" \
  --test-command "npx mocha 'test/unit/algum_spec.js' --timeout 10000" \
  --output "./logs/promise-trace.jsonl"
```

- `--project-dir` (obrigatório, absoluto): cwd em que o comando de teste roda.
- `--test-command` (obrigatório): o comando completo, como uma única string
  (exatamente como você digitaria no shell).
- `--output` (opcional, padrão `./logs/promise-trace.jsonl`).

O código de saída do `cli.js` é o mesmo código de saída do comando de teste —
então ele pode ser usado dentro de um pipeline de CI sem mascarar falhas.

### Rodando o exemplo incluído

```bash
node src-new/cli.js \
  --project-dir "$(pwd)/projects/micro-benchmarks/" \
  --test-command "node fetch_loop.js" \
  --output "./logs-src-new/sample-trace.jsonl"
```

```bash
node src-new/cli.js \
  --project-dir "$(pwd)/projects/micro-benchmarks/" \
  --test-command "node async_await_fetch.js" \
  --output "./logs-src-new/async_await_fetch-trace.jsonl"
```

```bash
node src-new/cli.js \
  --project-dir "$(pwd)/projects/micro-benchmarks/" \
  --test-command "node async_await_fs.js" \
  --output "./logs-src-new/async_await_fs-trace.jsonl"
```

> Recomendação prática, descoberta testando este protótipo: prefira chamar o
> binário do Mocha diretamente (`./node_modules/.bin/mocha ...`) em vez de
> `npx mocha ...` quando possível — ver "Limitações conhecidas" abaixo sobre
> por que `npx` polui bastante o log.


## Como o patch é injetado no processo filho

`cli.js` não roda o comando de teste diretamente — ele monta um `NODE_OPTIONS`
com `--require /caminho/absoluto/para/src/preload.js` e o injeta no ambiente
antes de dar `spawn()` no comando (ver `child-process-runner.js`):

```js
NODE_OPTIONS = "--require \"/.../promise-monkey-tracer/src/preload.js\""
```

Usamos `NODE_OPTIONS` (em vez de reescrever o comando como `node -r ... `)
porque o comando recebido normalmente já é algo como `npx mocha ...`, que
por sua vez decide como invocar o Node por baixo dos panos. `NODE_OPTIONS` é
respeitado por **qualquer** processo Node que venha a ser criado como parte
de rodar esse comando — incluindo os disparados pelo bin script do `npx` ou
do próprio `mocha`.

`--require` garante que `preload.js` termine de rodar **antes** de qualquer
módulo do projeto alvo (ou do Mocha) ser carregado. É esse `preload.js` que:
1. cria o logger (JSONL) e guarda as funções originais de que o tracer depende;
2. configura o `recorder`;
3. só então instala os patches de `src/patches/` (ver "Arquitetura").

Dois env vars extras acompanham o processo filho: `PROMISE_TRACER_OUTPUT`
(caminho do arquivo de log) e `PROMISE_TRACER_PROJECT_DIR` (usado só para a
heurística de "qual arquivo de teste" — ver abaixo). Opcionalmente,
`PROMISE_TRACER_TRACK_AWAIT=0` desliga o rastreamento de `await` (ver "Limitações").


## Arquitetura: como os ids são gerados sem `async_hooks`

Cada operação é observada na **fronteira da API**, isto é, no momento em que o
código do projeto a chama. Três camadas colaboram:

1. **`patches/`** — um arquivo por objeto monkey-patched. Cada patch troca as
   funções do objeto por wrappers que abrem um registro quando a operação começa.
2. **`core/context.js`** — responde "qual recurso assíncrono está executando
   agora?". É daí que sai o `triggerAsyncId`.
3. **`core/recorder.js`** — fecha o registro (status e tempos) e grava uma linha
   JSONL através do `logger.js`.

### `asyncId` e `triggerAsyncId`

- `asyncId`: contador próprio e crescente (`core/ids.js`). O id **1** é o
  "contexto raiz" (script principal ou origem não rastreada).
- `triggerAsyncId`: id do recurso cujo código estava rodando quando este foi criado.

| Situação | `triggerAsyncId` |
|---|---|
| operação criada dentro de um callback embrulhado (fs, timer, nextTick, queueMicrotask) | id do registro desse callback |
| operação criada dentro de um `.then(cb)` | id da promise derivada devolvida pelo `.then` |
| promise derivada (`.then`, `.catch`, `.finally`) | id da promise pai |
| operação criada dentro do executor de `new Promise` | id dessa promise |
| operação criada **depois de um `await p`** | id da promise `p` |
| origem não rastreada (streams, eventos, rede...) | 1 |

### Como o `await` é observado

O V8 não chama `then` num `await` de promise nativa, então não há onde
interceptar a continuação. Para torná-lo observável, `patches/promise-prototype.js`
troca `Promise.prototype.constructor` por um getter. A especificação lê
`promise.constructor` durante o `await`; ao receber um valor diferente do
`Promise` intrínseco, o motor passa a tratar a promise como "thenable" e chama o
nosso `then` num job de microtask. Isso revela (1) em que contexto o `await` foi
escrito e (2) quando a continuação será executada. Como a fila de microtasks é
FIFO, `core/context.js` mantém uma fila de contextos e uma microtask-marcador por
continuação, o que mantém o contexto correto mesmo com vários `await`
intercalados (verificado com dois fluxos concorrentes).

Awaits feitos **dentro do próprio Node** (frame mais interno em `node:`) mantêm o
caminho rápido nativo e não geram registro.

### O que vira registro e o que não vira

Só entram no log chamadas cujo stack síncrono contém algum frame fora de `node:`
(código do projeto ou de bibliotecas como o Mocha). `process.nextTick` e
`queueMicrotask`, que o Node usa o tempo todo por dentro, exigem que o frame mais
interno seja de código do usuário. Dentro de um wrapper, o tracing fica suspenso
(`callNative`), então o que o Node faz por baixo de uma chamada não vira ruído.

## Estrutura de pastas

```
promise-monkey-tracer/
├── package.json
├── README.md
├── examples/
│   └── sample-project/             # projeto Mocha de exemplo
└── src/
    ├── cli.js                      # entrada da CLI (inalterada)
    ├── child-process-runner.js     # spawn do comando com NODE_OPTIONS (inalterado)
    ├── preload.js                  # --require: logger, recorder e instalação dos patches
    ├── logger.js                   # escrita JSONL (stream + escrita síncrona no exit)
    ├── safe-serializer.js          # serialização segura de valores
    ├── stack-utils.js              # captura de stack e heurística de testFile
    ├── core/
    │   ├── intrinsics.js           # funções originais, guardadas antes dos patches
    │   ├── ids.js                  # asyncId próprio
    │   ├── context.js              # "quem está executando agora" (triggerAsyncId)
    │   ├── callsite.js             # captura e classifica o call site
    │   ├── recorder.js             # ciclo de vida dos registros e escrita
    │   └── wrap.js                 # construtores genéricos de wrappers
    └── patches/                    # UM arquivo por objeto monkey-patched
        ├── index.js                # lista e instalador
        ├── promise.js              # Promise (construtor + estáticos)
        ├── promise-prototype.js    # then / finally / await
        ├── fs.js                   # fs (callbacks)
        ├── fs-promises.js          # fs.promises
        ├── timers.js               # setTimeout / setInterval / setImmediate / clear*
        ├── process-next-tick.js    # process.nextTick
        └── queue-microtask.js      # queueMicrotask
```

## Esquema de cada linha do JSONL

```jsonc
{
  "internalId": "p4821_22",          // p<pid>_<asyncId>
  "pid": 4821,                       // asyncId reinicia por processo
  "asyncId": 22,
  "triggerAsyncId": 21,
  "origin": "promise-api",           // constructor | combinator | derived | observed |
                                     // promise-api | callback-api | timer | tick | microtask
  "type": "fs.promises.readFile",    // nome da operação
  "combinatorMethod": null,          // "all", "race"... em Promise.<combinador>
  "status": "fulfilled",             // fulfilled | rejected | adopted | aliased |
                                     // cancelled | pending-at-exit
  "createdAt": "2026-10-09T20:24:15.444Z",
  "settledAt": "2026-10-09T20:24:15.445Z",
  "durationMs": 0.91,                // hrtime; use este campo para durações
  "continuationRuns": 1,             // vezes que código rodou "dentro" do recurso
  "testFile": "test_async_await_fs.spec.js",   // heurística, pode ser null
  "target": "package.json",          // fs: caminho ou fd:N
  "delayMs": 2,                      // timers
  "inputCount": 2, "dependsOn": [31, 33],      // Promise.all/race/...
  "value": {"type": "...", "preview": "..."},  // new Promise / Promise.resolve
  "reason": {"type": "...", "preview": "..."}, // rejeições
  "stack": [ { "functionName": "...", "file": "...", "line": 6, "column": 34 } ]
}
```

- `fulfilled`/`rejected`: desfecho conhecido. `adopted`: resolvida com outra promise (o
  desfecho depende dela). `aliased`: `Promise.resolve(p)` devolveu a própria `p`.
  `cancelled`: `clearTimeout`/`clearInterval`/`clearImmediate`. `pending-at-exit`:
  nunca terminou até o fim do processo (`settledAt` é o instante do encerramento).
- `settledAt` marca o momento em que o tracer **soube** do desfecho: início do
  callback (fs/timers/nextTick), execução do handler (`.then`) ou primeira reação
  (`await`/`.then`) para promises devolvidas por APIs.
- Os campos de 0.1 foram mantidos, então `label-operations.js` e outras análises
  continuam funcionando; `type`, `pid`, `target`... são novos.

## Limitações conhecidas

1. **`await` custa 2 microticks a mais.** Para observá-lo, o `await` deixa o
   caminho rápido do V8 e passa a levar 3 ticks (comportamento do Node <= 10).
   Medido: `A:await | t1 | t2 | t3` vira `t1 | t2 | A:await | t3`. Código correto
   não deve depender disso, mas o tracer **perturba a ordem de eventos**. Com
   `PROMISE_TRACER_TRACK_AWAIT=0` a ordem fica idêntica à original, ao custo de
   perder o `triggerAsyncId` de tudo que vem depois de um `await`.
2. **Stack traces de erro perdem os frames `at async ...`** quando o `await`
   rastreado está ligado (o V8 não consegue mais seguir a cadeia de awaits).
3. **Desempenho:** cada operação captura e interpreta um stack. Medido ~27 µs por
   `await` (20.000 awaits: 7 ms sem tracer, 550 ms com).
4. **Operação "dispare e esqueça" não observada.** Uma promise de `fs.promises`
   que ninguém aguarda nem encadeia fica `pending-at-exit`, sem `settledAt` real.
   É proposital: observar a promise por conta própria mudaria o comportamento de
   `unhandledRejection` (verificado: sem e com o tracer o processo cai igual).
5. **Só a fronteira da API é observada.** Os passos internos (open/read/close de
   um `readFile`) não aparecem. Também **não cobertos ainda:** métodos de
   `FileHandle`, streams, `timers/promises`, `EventEmitter`, `child_process`,
   `net`/`http`, `dns`, `crypto`, `zlib`. Recursos criados a partir deles
   recebem `triggerAsyncId` 1.
6. **A cadeia de triggers atravessa testes.** O Mocha agenda o teste seguinte com
   `setImmediate` a partir do anterior, então esses registros do Mocha (sem frame
   no arquivo de teste) herdam a linha do último passo do teste anterior no
   `label-operations.js`.
7. **`Promise` global é um Proxy** (como na 0.1): `p.constructor === Promise` é
   `false`. Ler `promise.constructor` no código do usuário pode deixar uma
   entrada de `await` sem consumo (efeito: só o `triggerAsyncId` de uma promise
   ainda não observada pode sair impreciso).
8. **Processos múltiplos** (ex.: `npx` -> `mocha`) escrevem no mesmo arquivo.
   Use o `pid` para separar; prefira `./node_modules/.bin/mocha` ao `npx`.
9. **Durabilidade:** o que ainda estiver na fila do stream no momento de um
   `SIGKILL` pode se perder; no encerramento normal o fim do log é gravado
   de forma síncrona.

## Pontos de extensão

- **Nova operação assíncrona** (EventEmitter, child_process, dns, crypto...): crie
  um arquivo em `src/patches/` com `{ name, install(options) }` (use
  `wrapCallbackApi`/`wrapPromiseApi` de `core/wrap.js`) e acrescente-o à lista de
  `src/patches/index.js`.
- **ESM**: precisaria de `module.register()`/`--experimental-loader` além do
  `--require` atual.
- **Jest**: exige garantir `NODE_OPTIONS` em cada worker e reinstalar os patches
  por contexto `vm`.
- **Detecção automática de projeto/framework**: hoje `--test-command` é
  responsabilidade de quem chama a CLI.
