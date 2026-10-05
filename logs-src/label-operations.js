#!/usr/bin/env node
'use strict';

/**
 * label-operations.js
 * ---------------------------------------------------------------------------
 * Answers: "which literal line in my test file produced this activity?"
 * instead of: "is this node tagged as test-related?"
 *
 * For every record, find the DEEPEST frame in record.stack that sits inside
 * the target test file. If the record's OWN stack has none (common for
 * shallow native continuations - fd-close callbacks, SafePromise wrappers,
 * etc.), walk UP via triggerAsyncId until an ancestor with one is found.
 * Group everything by that line number. Records whose entire ancestry never
 * touches the test file (pure bootstrap/framework noise) are reported
 * separately as "unattributed" rather than silently dropped.
 *
 * This generalizes to any project: swap the second CLI argument for any
 * test file name, and it groups that file's trace by line number with no
 * other code changes. It also no longer depends on the tracer's testFile
 * heuristic at all (only used below for an upfront sanity-check printout),
 * so it is immune to the heuristic's known blind spots.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

async function loadRecords(tracePath) {
  const records = [];
  const rl = readline.createInterface({ input: fs.createReadStream(tracePath), crlfDelay: Infinity });
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

function ownAnchor(record, targetBasename) {
  if (!Array.isArray(record.stack)) return null;
  const frame = record.stack.find((f) => f.file && path.basename(f.file) === targetBasename);
  return frame ? { line: frame.line, column: frame.column } : null;
}

function resolveOperations(records, targetBasename) {
  const byId = new Map();
  for (const r of records) if (r.asyncId != null) byId.set(r.asyncId, r);

  const anchorCache = new Map(); // asyncId -> {line,column} | null

  function resolve(id, guard = new Set()) {
    if (anchorCache.has(id)) return anchorCache.get(id);
    if (guard.has(id)) return null; // defensive cycle guard
    guard.add(id);

    const rec = byId.get(id);
    if (!rec) {
      anchorCache.set(id, null);
      return null;
    }
    const own = ownAnchor(rec, targetBasename);
    if (own) {
      anchorCache.set(id, own);
      return own;
    }
    const inherited = rec.triggerAsyncId != null ? resolve(rec.triggerAsyncId, guard) : null;
    anchorCache.set(id, inherited);
    return inherited;
  }

  const byLine = new Map(); // line -> records[]
  const unattributed = [];

  for (const r of records) {
    if (r.asyncId == null) continue;
    const anchor = resolve(r.asyncId);
    if (!anchor) {
      unattributed.push(r);
      continue;
    }
    if (!byLine.has(anchor.line)) byLine.set(anchor.line, []);
    byLine.get(anchor.line).push(r);
  }

  return { byLine, unattributed };
}

function toMs(value) {
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
}

function windowOf(group) {
  const starts = group.map((r) => toMs(r.createdAt)).filter((n) => n != null);
  const ends = group.map((r) => toMs(r.settledAt)).filter((n) => n != null);
  if (!starts.length) return null;
  return { start: Math.min(...starts), end: Math.max(...(ends.length ? ends : starts)) };
}

function overlaps(a, b) {
  return a && b && a.start <= b.end && b.start <= a.end;
}

async function main() {
  const [, , tracePath, testFileArg] = process.argv;
  if (!tracePath) {
    console.error('usage: node label-operations.js <trace.jsonl> [testFileNameOrPath]');
    process.exit(1);
  }

  const records = await loadRecords(tracePath);

  // --- sanity-check printout: this alone would have caught the earlier bug ---
  const seenTestFiles = new Map();
  for (const r of records) {
    if (typeof r.testFile === 'string') {
      seenTestFiles.set(r.testFile, (seenTestFiles.get(r.testFile) || 0) + 1);
    }
  }
  console.log(`total records in trace: ${records.length}`);
  console.log('distinct non-null testFile values the tracer itself tagged:');
  if (seenTestFiles.size === 0) {
    console.log('  (none in this log)');
  } else {
    for (const [name, count] of seenTestFiles) console.log(`  "${name}" - ${count} records`);
  }
  console.log('');

  const targetBasename = path.basename(testFileArg || [...seenTestFiles.keys()][0] || '');
  if (!targetBasename) {
    console.error('No test file given and none could be guessed from the log - pass one explicitly.');
    process.exit(1);
  }
  console.log(`resolving operations against test file: "${targetBasename}" (basename match, path ignored)\n`);

  const { byLine, unattributed } = resolveOperations(records, targetBasename);
  const lines = [...byLine.keys()].sort((a, b) => a - b);

  console.log(`operations found - one row per distinct line in ${targetBasename}:\n`);
  console.log('line   nodes   window(ms)   asyncIds');
  const windows = [];
  for (const line of lines) {
    const group = byLine.get(line);
    const w = windowOf(group);
    windows.push({ line, w });
    const span = w ? (w.end - w.start).toFixed(1) : '?';
    console.log(`${String(line).padEnd(6)} ${String(group.length).padEnd(7)} ${String(span).padEnd(12)} ${group.map((r) => r.asyncId).join(',')}`);
  }

  console.log(`\nunattributed records (no test-file frame anywhere in their ancestry - bootstrap/framework noise): ${unattributed.length}`);

  // A line whose window fully contains every other line's window is almost
  // certainly an enclosing scope (the `it(...)`/async function wrapping the
  // statement under test), not an independent concurrent operation -
  // triggerAsyncId can't tell us that directly (lexical nesting isn't
  // promise-creation causality), so this is a pragmatic time-based proxy.
  const withWindows = windows.filter((x) => x.w);
  const enclosing = withWindows.find((cand) =>
    withWindows.every((other) => other === cand || (cand.w.start <= other.w.start && cand.w.end >= other.w.end))
  );
  if (enclosing) {
    console.log(`\nline ${enclosing.line} window contains every other line's window - treating it as the enclosing scope, excluded below.`);
  }

  console.log('\npossible concurrent / non-causal overlaps between DIFFERENT (non-enclosing) lines:');
  console.log('(time-window overlap only - necessary but not sufficient for a real race; see caveat in chat)');
  const candidates = withWindows.filter((x) => x !== enclosing);
  let any = false;
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      if (overlaps(candidates[i].w, candidates[j].w)) {
        any = true;
        console.log(`  line ${candidates[i].line} <-> line ${candidates[j].line}`);
      }
    }
  }
  if (!any) console.log('  none found');
}

main();