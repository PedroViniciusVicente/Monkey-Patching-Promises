# Micro-benchmarks

# Default Test Execution
```bash
npx mocha test_async_await.spec.js
```


## Instrumentation

```bash
node src/cli.js \
  --cmd "./node_modules/.bin/mocha test_async_await_simple.spec.js" \
  --path "$(pwd)/projects/micro-benchmarks" \
  --out "./logs-micro-benchmark/test_async_await_simple-asynchooks-promise-trace.ndjson"
```

```bash
node src/cli.js \
  --cmd "./node_modules/.bin/mocha test_async_await_fetch.spec.js" \
  --path "$(pwd)/projects/micro-benchmarks" \
  --out "./logs-micro-benchmark/test_async_await_fetch-asynchooks-promise-trace.ndjson"
```

```bash
node src/cli.js \
  --cmd "./node_modules/.bin/mocha test_async_await_fs.spec.js" \
  --path "$(pwd)/projects/micro-benchmarks" \
  --out "./logs-micro-benchmark/test_async_await_fs-asynchooks-promise-trace.ndjson"
```