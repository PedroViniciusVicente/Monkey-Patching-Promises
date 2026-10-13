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


# october 13
```bash
node src/cli.js \
  --project-dir "$(pwd)/projects/micro-benchmarks/" \
  --test-command "node async_await_fs.js" \
  --output "./logs-src-october-13/async_await_fs-trace.jsonl"
```

```bash
node src/cli.js \
  --project-dir "$(pwd)/projects/micro-benchmarks/" \
  --test-command "node async_await_fetch.js" \
  --output "./logs-src-october-13/async_await_fetch-trace.jsonl"
```

```bash
node src/cli.js \
  --project-dir "$(pwd)/projects/micro-benchmarks/" \
  --test-command "node fetch_loop.js" \
  --output "./logs-src-october-13/fetch_loop-trace.jsonl"
```

```bash
node src/cli.js \
  --project-dir "$(pwd)/projects/micro-benchmarks/" \
  --test-command "./node_modules/.bin/mocha test_async_await_fetch.spec.js" \
  --output "./logs-src-october-13/test_async_await_fetch-trace.jsonl"
```

```bash
node src/cli.js \
  --project-dir "$(pwd)/projects/micro-benchmarks/" \
  --test-command "./node_modules/.bin/mocha test_race.spec.js" \
  --output "./logs-src-october-13/test_race-trace.jsonl"
```

## flowfuse
```bash
node src/cli.js \
  --project-dir "$(pwd)/projects/opensource-projects/flowfuse" \
  --test-command "./node_modules/.bin/mocha 'test/unit/forge/routes/api/team_spec.js' --timeout 10000 -g 'with all instances and their status'" \
  --output "./logs-src-october-13/flowfuse-trace.jsonl"
```

## milo
```bash
node src/cli.js \
  --project-dir "$(pwd)/projects/opensource-projects/milo" \
  --test-command "npx wtr --config ./web-test-runner.config.mjs --node-resolve --port=2000 test/utils/logWebVitalsUtils.test.js" \
  --output "./logs-src-october-13/milo-trace.jsonl"
```