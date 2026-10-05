## flowfuse
```bash
node src/cli.js \
  --project-dir "$(pwd)/projects/flowfuse" \
  --test-command "./node_modules/.bin/mocha 'test/unit/forge/routes/api/team_spec.js' --timeout 10000 -g 'with all instances and their status'" \
  --output "./logs/flowfuse-sample-trace.jsonl"
```
## Micro-benchmarks/test_async_await_fs.spec.js
```bash
node src/cli.js \
  --project-dir "$(pwd)/projects/micro-benchmarks" \
  --test-command "./node_modules/.bin/mocha test_async_await_fs.spec.js" \
  --output "./logs-src/test_async_await_fs-trace.jsonl"
```

## Micro-benchmarks/test_promise_all.spec.js
```bash
node src/cli.js \
  --project-dir "$(pwd)/projects/micro-benchmarks" \
  --test-command "./node_modules/.bin/mocha test_promise_all.spec.js" \
  --output "./logs-src/test_promise_all-trace.jsonl"
```

## Micro-benchmarks/test_race.spec.js
```bash
node src/cli.js \
  --project-dir "$(pwd)/projects/micro-benchmarks" \
  --test-command "./node_modules/.bin/mocha test_race.spec.js" \
  --output "./logs-src/test_race-trace.jsonl"
```

> pedroubuntu@Aspire-A514-54:~/Desktop/monkey_patching_projects$ node src/cli.js   --project-dir "$(pwd)/projects/micro-benchmarks"   --test-command "./node_modules/.bin/mocha test_promise_all.spec.js"   --output "./logs-src/test_promise_all-trace.jsonl"
> [promise-monkey-tracer] projeto : /home/pedroubuntu/Desktop/monkey_patching_projects/projects/micro-benchmarks
> [promise-monkey-tracer] comando : ./node_modules/.bin/mocha test_promise_all.spec.js
> [promise-monkey-tracer] output  : /home/pedroubuntu/Desktop/monkey_patching_projects/logs-src/test_promise_all-trace.jsonl
> ---
> [promise-monkey-tracer] ativo - escrevendo em /home/pedroubuntu/Desktop/monkey_patching_projects/logs-src/test_promise_all-trace.jsonl
>
>
>  micro-benchmark tests
>    ✔ should test promise.all (213ms)
>
>
>  1 passing (215ms)
>
> ---
