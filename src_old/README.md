```bash
node src/cli.js \
  --project-dir "$(pwd)/projects/flowfuse" \
  --test-command "./node_modules/.bin/mocha 'test/unit/forge/routes/api/team_spec.js' --timeout 10000 -g 'with all instances and their status'" \
  --output "./logs/flowfuse-sample-trace.jsonl"
```

```bash
node src_old/cli.js \
  --project-dir "$(pwd)/projects/micro-benchmarks" \
  --test-command "./node_modules/.bin/mocha test_async_await_fs.spec.js" \
  --output "./logs-old-src/test_async_await_fs-trace.jsonl"
```