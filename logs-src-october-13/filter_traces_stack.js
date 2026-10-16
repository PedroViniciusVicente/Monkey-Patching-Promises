/*
node filter_traces_stack.js async_await_fetch-trace.jsonl /home/pedroubuntu/Desktop/monkey_patching_projects/projects/micro-benchmarks/async_await_fetch.js _filtered-async_await_fetch-trace.json
// filtrou 12 para 2 OK!
node filter_traces_stack.js async_await_fs-trace.jsonl /home/pedroubuntu/Desktop/monkey_patching_projects/projects/micro-benchmarks/async_await_fs.js _filtered-async_await_fs-trace.json
// filtrou 1 para 1 OK!
node filter_traces_stack.js fetch_loop-trace.jsonl /home/pedroubuntu/Desktop/monkey_patching_projects/projects/micro-benchmarks/fetch_loop.js _filtered-fetch_loop-trace.json
// filtrou 32 para 6 OK!
node filter_traces_stack.js test_async_await_fetch-trace.jsonl /home/pedroubuntu/Desktop/monkey_patching_projects/projects/micro-benchmarks/test_async_await_fetch.spec.js _filtered-test_async_await_fetch-trace.json
// filtrou 39 para 2 OK!
node filter_traces_stack.js test_race-trace.jsonl /home/pedroubuntu/Desktop/monkey_patching_projects/projects/micro-benchmarks/test_race.spec.js _filtered-test_race-trace.json
// filtrou 41 para 5 OK!
node filter_traces_stack.js flowfuse-trace.jsonl /home/pedroubuntu/Desktop/monkey_patching_projects/projects/opensource-projects/flowfuse/test/unit/forge/routes/api/team_spec.js _filtered-flowfuse-trace.json
// filtrou 7852 para 6 (nao OK)
node filter_traces_stack.js milo-trace.jsonl /home/pedroubuntu/Desktop/monkey_patching_projects/projects/opensource-projects/milo/test/utils/logWebVitalsUtils.test.js _filtered-milo-trace.json
// filtrou 2891 para 0 (nao OK)
*/

// filter_traces_stack.js
const fs = require('fs');
const readline = require('readline');
const path = require('path');

// 1. Validação de argumentos do console
const [,, inputFile, targetFileArg, outputFile] = process.argv;

if (!inputFile || !targetFileArg || !outputFile) {
  console.error('\x1b[31mErro: Argumentos insuficientes.\x1b[0m');
  console.log('Uso: node filter_traces_stack.js <arquivo_input.jsonl> <TARGET_FILE> <arquivo_output.json>');
  console.log('Exemplo: node filter_traces_stack.js fetch_loop-trace.jsonl /home/user/app.js filtered_output.json');
  process.exit(1);
}

// Normaliza o caminho do arquivo alvo para evitar erros por conta de caminhos relativos/absolutos
const absoluteTargetFile = path.resolve(targetFileArg);

/**
 * Retorna o primeiro frame da call stack que pertence ao código do usuário
 * (ignorando módulos internos do Node.js).
 */
function getFirstUserFrame(stack) {
  if (!Array.isArray(stack)) return null;
  
  return stack.find(frame => {
    if (!frame.file) return false;
    // Ignora módulos nativos e internos do Node.js
    const isNodeInternal = frame.file.startsWith("node:") || frame.file.includes("node:internal");
    return !isNodeInternal;
  });
}

/**
 * Filtra se o trace pertence diretamente a uma chamada originada no TARGET_FILE
 */
/**
 * Filtra para obter apenas as Promises de APIs públicas (fetch e res.json)
 * geradas diretamente pelo código do usuário.
 */
function isDirectUserTrace(trace, targetFile) {
  // 1. Considera apenas criação de Promises primárias
//   if (trace.origin && trace.origin !== "constructor") {
//     return false;
//   }
  if (trace.origin && (trace.origin === "derived" || trace.origin === "observed")) {
    return false;
  }

  // 2. Encontra o índice do primeiro frame que pertence ao código do usuário
//   const userFrameIndex = trace.stack.findIndex(frame => {
//     if (!frame.file) return false;
//     return !frame.file.startsWith("node:") && !frame.file.includes("node:internal");
//   });

//   if (userFrameIndex === -1) return false;

    // 2. Encontra QUALQUER frame que seja o target file
    const targetFrameIndex = trace.stack.findIndex(frame => {
        if (!frame.file) return false;
        return path.resolve(frame.file) === targetFile;
    });

    if (targetFrameIndex === -1) return false;

  // 3. Valida se o arquivo desse frame é o alvo analisado
//   const isTargetFile = path.resolve(trace.stack[userFrameIndex].file) === targetFile;
//   if (!isTargetFile) return false;

  // 4. HEURÍSTICA DE REFINAMENTO:
  // Filtra apenas Promises criadas via 'createDeferredPromise' (usada por Web APIs públicas)
  // e com uma profundidade rasa até o código do usuário (<= 4 frames).
//   const topFrame = trace.stack[0];
//   const isPublicWebApi = topFrame && topFrame.functionName === "createDeferredPromise";
//   const isShallowStack = userFrameIndex <= 4;

  // Opcional: ainda pode querer limitar a profundidade
  const isShallowStack = targetFrameIndex <= 4;

//   return isPublicWebApi && isShallowStack;
  return isShallowStack;
}

/**
 * Executa a leitura via streaming para garantir baixo consumo de memória em arquivos de trace grandes
 */
async function processTraceFile() {
  const inputPath = path.resolve(inputFile);
  
  if (!fs.existsSync(inputPath)) {
    console.error(`\x1b[31mErro: O arquivo de entrada "${inputPath}" não foi encontrado.\x1b[0m`);
    process.exit(1);
  }

  const fileStream = fs.createReadStream(inputPath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  const matchedTraces = [];
  let totalLines = 0;

  for await (const line of rl) {
    totalLines++;
    if (!line.trim()) continue;

    try {
      const trace = JSON.parse(line);
      if (isDirectUserTrace(trace, absoluteTargetFile)) {
        matchedTraces.push(trace);
      }
    } catch (err) {
      console.warn(`\x1b[33mAviso: Falha ao analisar o JSON na linha ${totalLines}: ${err.message}\x1b[0m`);
    }
  }

  const outputPath = path.resolve(outputFile);
  fs.writeFileSync(outputPath, JSON.stringify(matchedTraces, null, 2), 'utf-8');

  console.log('\n\x1b[32m✔ Processamento concluído!\x1b[0m');
  console.log(`- Traces lidos:     ${totalLines}`);
  console.log(`- Traces filtrados: ${matchedTraces.length}`);
  console.log(`- Output gerado:    ${outputPath}\n`);
}

processTraceFile().catch(err => {
  console.error('\x1b[31mErro fatal durante o processamento:\x1b[0m', err);
  process.exit(1);
});