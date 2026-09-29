## Commands
### flowfuse
```bash
nvm use 20

node src/cli.js \
  --cmd "npx mocha 'test/unit/forge/routes/api/team_spec.js' --timeout 10000 --node-option=unhandled-rejections=strict -g 'with all instances and their status'" \
  --path "/home/pedroubuntu/Desktop/monkey_patching_projects/projects/flowfuse" \
  --out "./logs/flowfuse-async-promise-trace.ndjson"
```
#### gutenberg
```bash
nvm use 20

node src/cli.js \
  --cmd "npx jest --config test/unit/jest.config.js packages/components/src/tabs/test/index.tsx -t 'should continue to handle arrow key navigation properly' --silent" \
  --path "/home/pedroubuntu/Desktop/monkey_patching_projects/projects/gutenberg" \
  --out "./logs/gutenberg-async-promise-trace.ndjson"
```
#### milo
```bash
nvm use 20

node src/cli.js \
  --cmd "npx wtr --config ./web-test-runner.config.mjs --node-resolve --port=2000 test/utils/logWebVitalsUtils.test.js" \
  --path "/home/pedroubuntu/Desktop/monkey_patching_projects/projects/milo" \
  --out "./logs/milo-async-promise-trace.ndjson"
```
#### timed-frontend
```bash
nvm use 14

node src/cli.js \
  --cmd "npx ember test --launch Chrome --filter='Acceptance | statistics: can view statistics by task'" \
  --path "/home/pedroubuntu/Desktop/monkey_patching_projects/projects/timed-frontend" \
  --out "./logs/timed-frontend-async-promise-trace.ndjson"
```

###
```bash
nvm use 22

node src/cli.js \
  --cmd "npm run test:mocha -- src/test.js --grep 'promiseMiddleware should not call next if the handler sets response.finished'" \
  --path "/home/pedroubuntu/Desktop/monkey_patching_projects/projects/express-promise-middleware/" \
  --out "./logs/express-promise-async-promise-trace.ndjson"
```

## Metrics

```json
{
    "event":"create",
    "id":10868,
    "origin":"async-function",
    "asyncId":13542,
    "triggerAsyncId":13530,
    "executionAsyncId":13528,
    "status":"unknown",
    "createdAt":"2026-09-29T07:00:15.046Z",
    "settledAt":null,
    "durationMs":null,
    "callSite":{
        "file":"/home/pedroubuntu/Desktop/monkey_patching_projects/projects/flowfuse/test/unit/forge/routes/api/team_spec.js",
        "line":510,
        "column":54,
        "function":"<anonymous>"
    },
    "value":null
}
```