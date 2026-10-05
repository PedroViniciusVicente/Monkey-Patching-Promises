#!/usr/bin/env node
'use strict';

/**
 * reconstruct-chain.js
 * ---------------------------------------------------------------------------
 * Generic post-processor for promise-monkey-tracer JSONL output.
 *
 * Problem this solves: `testFile` is a best-effort, per-node heuristic
 * (stack-utils.js -> guessTestFile) computed independently for each promise
 * from ITS OWN synchronous creation stack. Deep/native continuations (fd
 * close callbacks, primordial SafePromise wrappers, mocha-internal
 * continuations, etc.) very often have a creation stack with zero frames
 * that match the heuristic, even though they are 100% causally part of the
 * same operation. Filtering `record.testFile === targetFile` therefore
 * UNDER-reports the chain.
 *
 * The fix: `triggerAsyncId` is NOT a heuristic - it's the actual causality
 * edge Node's async_hooks gives you. So:
 *   1. Find "seed" nodes: testFile matches the target (or, for
 *      generalization, ANY caller-supplied predicate over the record).
 *   2. Walk the triggerAsyncId graph from the seeds in BOTH directions
 *      (ancestors AND descendants) until nothing new is reachable.
 *   3. That connected component *is* the operation's full causal chain,
 *      independent of which individual nodes happened to keep a
 *      test-identifiable stack frame.
 *
 * This generalizes to "any async operation in any project" because it does
 * not hardcode fs.readFile anywhere - it only needs a seed predicate. Two
 * useful seed predicates are provided: byTestFile() and byStackPattern().
 * Usage:
 *   node graph_builder.js <trace.jsonl> [testFileSubstring]
 */

const fs = require('fs');
const readline = require('readline');

async function loadRecords(path) {
  const records = [];
  const rl = readline.createInterface({ input: fs.createReadStream(path), crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      records.push(JSON.parse(trimmed));
    } catch (err) {
      process.stderr.write(`skipping malformed line: ${err.message}\n`);
    }
  }
  return records;
}

// --- seed predicates (swap/compose these to generalize to other projects) ---

function byTestFile(substring) {
  return (record) => typeof record.testFile === 'string' && record.testFile.includes(substring);
}

// Fallback/extra seed source for projects where testFile is mostly null:
// match directly on stack frame text (function name or file) if the raw
// `stack` array is present in the log (it is, in the real tracer output;
// this trimmed sample omits it to stay short).
function byStackPattern(pattern) {
  const re = pattern instanceof RegExp ? pattern : new RegExp(pattern);
  return (record) =>
    Array.isArray(record.stack) &&
    record.stack.some((f) => re.test(f.functionName || '') || re.test(f.file || ''));
}

function reconstructClosure(records, seedPredicate) {
  const byId = new Map();
  const childrenOf = new Map();
  for (const r of records) {
    if (r.asyncId == null) continue; // e.g. logFallback rows with asyncId:null
    byId.set(r.asyncId, r);
    if (r.triggerAsyncId != null) {
      if (!childrenOf.has(r.triggerAsyncId)) childrenOf.set(r.triggerAsyncId, []);
      childrenOf.get(r.triggerAsyncId).push(r.asyncId);
    }
  }

  const seeds = records.filter(seedPredicate).map((r) => r.asyncId);
  const visited = new Set(seeds);
  const queue = [...seeds];
  const danglingParents = new Set(); // triggerAsyncId values with no record of their own

  while (queue.length) {
    const id = queue.pop();
    const rec = byId.get(id);

    const parent = rec ? rec.triggerAsyncId : null;
    if (parent != null) {
      if (byId.has(parent)) {
        if (!visited.has(parent)) {
          visited.add(parent);
          queue.push(parent);
        }
      } else {
        danglingParents.add(parent);
      }
    }

    for (const child of childrenOf.get(id) || []) {
      if (!visited.has(child)) {
        visited.add(child);
        queue.push(child);
      }
    }
  }

  const closure = [...visited]
    .map((id) => byId.get(id))
    .filter(Boolean)
    .sort((a, b) => a.asyncId - b.asyncId);

  return { closure, seeds, danglingParents };
}

async function main() {
  const [, , tracePath, testFileArg] = process.argv;
  if (!tracePath) {
    console.error('usage: node reconstruct-chain.js <trace.jsonl> [testFileSubstring]');
    process.exit(1);
  }
  const target = testFileArg || 'test_async_await_fs.spec.js';

  const records = await loadRecords(tracePath);
  const { closure, seeds, danglingParents } = reconstructClosure(records, byTestFile(target));

  const recoveredCount = closure.filter((r) => r.testFile == null).length;

  console.log(`total records in trace:        ${records.length}`);
  console.log(`seed nodes (testFile matched): ${seeds.length}`);
  console.log(`full causal closure size:      ${closure.length}`);
  console.log(`  of which recovered via graph (testFile was null): ${recoveredCount}`);
  console.log(`external/dangling parent ids (non-Promise resources or out-of-window): ${[...danglingParents].join(', ') || 'none'}`);
  console.log('');
  console.log('asyncId  triggerAsyncId  testFile?  durationMs  note');
  for (const r of closure) {
    console.log(
      `${String(r.asyncId).padEnd(8)} ${String(r.triggerAsyncId).padEnd(15)} ${(r.testFile ? 'yes' : 'RECOVERED').padEnd(10)} ${r.durationMs.toFixed(3).padEnd(11)} ${r.note || ''}`
    );
  }

  console.log('\n--- mermaid graph (paste into a mermaid renderer) ---\n');
  console.log(toMermaid(closure, seeds));
}

function toMermaid(closure, seeds) {
  const seedSet = new Set(seeds);
  const lines = ['graph TD'];
  const externalRoots = new Set();
  for (const r of closure) {
    lines.push(`  n${r.asyncId}["${r.asyncId}${r.note ? ': ' + r.note.slice(0, 28) : ''}"]`);
    if (r.triggerAsyncId != null) {
      if (closure.some((c) => c.asyncId === r.triggerAsyncId)) {
        lines.push(`  n${r.triggerAsyncId} --> n${r.asyncId}`);
      } else {
        externalRoots.add(r.triggerAsyncId);
        lines.push(`  ext${r.triggerAsyncId}((external ${r.triggerAsyncId})) --> n${r.asyncId}`);
      }
    }
  }
  for (const r of closure) {
    if (!seedSet.has(r.asyncId)) lines.push(`  style n${r.asyncId} stroke-dasharray: 4 2`);
  }
  return lines.join('\n');
}

main();