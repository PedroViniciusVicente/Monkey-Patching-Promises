```bash
node src/cli.js \
  --project-dir "$(pwd)/projects/micro-benchmarks/" \
  --test-command "node fetch_loop.js" \
  --output "./logs-src-new/fetch_loop_src-new-v2-traces.jsonl"
```

```bash
node src/cli.js \
  --project-dir "$(pwd)/projects/micro-benchmarks/" \
  --test-command "node fetch_loop.js" \
  --output "./logs-src-new/sample-trace.jsonl"
```

```bash
node src/cli.js \
  --project-dir "$(pwd)/projects/micro-benchmarks/" \
  --test-command "node async_await_fetch.js" \
  --output "./logs-src-new/async_await_fetch-trace.jsonl"
```

```bash
node src/cli.js \
  --project-dir "$(pwd)/projects/micro-benchmarks/" \
  --test-command "node async_await_fs.js" \
  --output "./logs-src-new/async_await_fs-trace.jsonl"
```