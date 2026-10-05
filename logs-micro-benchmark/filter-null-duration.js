// filter-null-duration.js
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const inputFile = process.argv[2] || 'logs-micro-benchmark/test_async_await_fs-asynchooks-promise-trace.ndjson';
const outputFile = process.argv[3] || inputFile.replace(/\.ndjson$/, '.filtered.ndjson');

async function filterFile() {
  const readStream = fs.createReadStream(inputFile, { encoding: 'utf8' });
  const writeStream = fs.createWriteStream(outputFile, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: readStream, crlfDelay: Infinity });

  let kept = 0;
  let removed = 0;

  for await (const line of rl) {
    if (!line.trim()) continue;

    // Remove lines that contain "durationMs":null (ignoring whitespace variations)
    if (/"durationMs"\s*:\s*null/.test(line)) {
      removed++;
      continue;
    }

    writeStream.write(line + '\n');
    kept++;
  }

  writeStream.end();
  writeStream.on('finish', () => {
    console.log(`Done.`);
    console.log(`   Input:   ${path.resolve(inputFile)}`);
    console.log(`   Output:  ${path.resolve(outputFile)}`);
    console.log(`   Kept:    ${kept} lines`);
    console.log(`   Removed: ${removed} lines`);
  });
}

filterFile().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});