/*
node resume_traces.js import_fs-trace.jsonl /home/pedroubuntu/Desktop/monkey_patching_projects/projects/micro-benchmarks/ESModules_scripts/import_fs.mjs _filtered-import_fs-trace.json
node resume_traces.js import_fs_2-trace.jsonl /home/pedroubuntu/Desktop/monkey_patching_projects/projects/micro-benchmarks/ESModules_scripts/import_fs_2.mjs _filtered-import_fs_2-trace.json
// filtrou de 26 para 13, era para ser 14
node resume_traces.js import_crypto-trace.jsonl /home/pedroubuntu/Desktop/monkey_patching_projects/projects/micro-benchmarks/ESModules_scripts/import_crypto.mjs _filtered-import_crypto-trace.json
// filtrou de 14 para 9, OK!
node resume_traces.js import_sqlite-trace.jsonl /home/pedroubuntu/Desktop/monkey_patching_projects/projects/micro-benchmarks/ESModules_scripts/import_sqlite.mjs _filtered-import_sqlite-trace.json
// filtrou de 14 para 13, OK!
node resume_traces.js import_bcrypt-trace.jsonl /home/pedroubuntu/Desktop/monkey_patching_projects/projects/micro-benchmarks/ESModules_scripts/import_bcrypt.mjs _filtered-import_bcrypt-trace.json
// filtrou de 19 para 12, OK!
node resume_traces.js import_stream-trace.jsonl /home/pedroubuntu/Desktop/monkey_patching_projects/projects/micro-benchmarks/ESModules_scripts/import_stream.mjs _filtered-import_stream-trace.json
// filtrou de 30 para 18, era para ser 10?
*/

// resume_traces.js
/* 
** Apenas resume traces de um arquivo JSONL, mantendo apenas o primeiro frame da call stack que corresponde a um arquivo alvo específico.
** E se tiver mais de um trace com mesma linha e coluna, ele pega apenas aqueles que são empatados no menor valor de profundidade dentro da stack (assim removendo aqueles que são de operações internas, mas deixando passar aqueles que tem mesma linha e coluna por estarem dentro de um for). Outra possibilidade seria em caso de mais de um log com mesmo arquivo e linha, pegar apenas aqueles cujo origin é diferente de observed ou derived
*/
const fs = require('fs');
const readline = require('readline');
const path = require('path');

// 1. Validação de argumentos do console
const [,, inputFile, targetFileArg, outputFile] = process.argv;

if (!inputFile || !targetFileArg || !outputFile) {
  console.error('\x1b[31mErro: Argumentos insuficientes.\x1b[0m');
  console.log('Uso: node filter_traces_stack.js <arquivo_input.jsonl> <TARGET_FILE> <arquivo_output.json>');
  process.exit(1);
}

const absoluteTargetFile = path.resolve(targetFileArg);

/**
 * Encontra o frame do arquivo alvo e retorna sua informação e profundidade na stack.
 */
function getTargetFrameInfo(stack, targetFilePath) {
  if (!Array.isArray(stack)) return null;

  const targetFrameIndex = stack.findIndex(frame => {
    if (!frame || !frame.file) return false;
    const cleanPath = frame.file.replace(/^file:\/\//, '');
    return path.resolve(cleanPath) === targetFilePath;
  });

  if (targetFrameIndex === -1) return null;

  return {
    frame: stack[targetFrameIndex],
    depth: targetFrameIndex
  };
}

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

  const rawTraces = [];
  let totalLines = 0;

  // 1. Leitura e extração inicial de todos os registros válidos do arquivo alvo
  for await (const line of rl) {
    totalLines++;
    if (!line.trim()) continue;

    try {
      const trace = JSON.parse(line);
      const frameInfo = getTargetFrameInfo(trace.stack, absoluteTargetFile);

      if (!frameInfo) continue;

      const { frame, depth } = frameInfo;

      rawTraces.push({
        internalId: trace.internalId ?? null,
        functionName: frame.functionName ?? null,
        line: frame.line ?? null,
        column: frame.column ?? null,
        file: frame.file ?? null,
        triggerAsyncId: trace.triggerAsyncId ?? null,
        type: trace.type ?? null,
        stackDepth: depth
      });

    } catch (err) {
      console.warn(`\x1b[33mAviso: Falha ao analisar o JSON na linha ${totalLines}: ${err.message}\x1b[0m`);
    }
  }

  // 2. Mapeia o menor stackDepth encontrado para cada coordenada (linha:coluna)
  const minDepthPerCallSite = new Map();

  for (const trace of rawTraces) {
    const key = `${trace.line}:${trace.column}`;
    const currentMin = minDepthPerCallSite.get(key);

    if (currentMin === undefined || trace.stackDepth < currentMin) {
      minDepthPerCallSite.set(key, trace.stackDepth);
    }
  }

  // 3. Filtra mantendo apenas os logs com o menor stackDepth para sua linha e coluna
  const processedTraces = rawTraces.filter(trace => {
    const key = `${trace.line}:${trace.column}`;
    const minDepth = minDepthPerCallSite.get(key);
    return trace.stackDepth === minDepth;
  });

  const outputPath = path.resolve(outputFile);
  fs.writeFileSync(outputPath, JSON.stringify(processedTraces, null, 2), 'utf-8');

  console.log('\n\x1b[32m✔ Processamento concluído!\x1b[0m');
  console.log(`- Traces lidos:      ${totalLines}`);
  console.log(`- Registros mantidos: ${processedTraces.length}`);
  console.log(`- Output gerado:     ${outputPath}\n`);
}

processTraceFile().catch(err => {
  console.error('\x1b[31mErro fatal durante o processamento:\x1b[0m', err);
  process.exit(1);
});