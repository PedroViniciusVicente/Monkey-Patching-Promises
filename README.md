## Commands
### flowfuse
```bash
nvm use 20

node src/cli.js \
  --cmd "npx mocha 'test/unit/forge/routes/api/team_spec.js' --timeout 10000 --node-option=unhandled-rejections=strict -g 'with all instances and their status'" \
  --path "/home/pedroubuntu/Desktop/monkey_patching_projects/projects/flowfuse" \
  --out "./logs/flowfuse-async-promise-trace.ndjson"
```
### gutenberg
```bash
nvm use 20

node src/cli.js \
  --cmd "npx jest --config test/unit/jest.config.js packages/components/src/tabs/test/index.tsx -t 'should continue to handle arrow key navigation properly' --silent" \
  --path "/home/pedroubuntu/Desktop/monkey_patching_projects/projects/gutenberg" \
  --out "./logs/gutenberg-async-promise-trace.ndjson"
```
### milo
```bash
nvm use 20

node src/cli.js \
  --cmd "npx wtr --config ./web-test-runner.config.mjs --node-resolve --port=2000 test/utils/logWebVitalsUtils.test.js" \
  --path "/home/pedroubuntu/Desktop/monkey_patching_projects/projects/milo" \
  --out "./logs/milo-async-promise-trace.ndjson"
```
### timed-frontend
```bash
nvm use 14

node src/cli.js \
  --cmd "npx ember test --launch Chrome --filter='Acceptance | statistics: can view statistics by task'" \
  --path "/home/pedroubuntu/Desktop/monkey_patching_projects/projects/timed-frontend" \
  --out "./logs/timed-frontend-async-promise-trace.ndjson"
```
npx ember test --launch Chrome --filter="Acceptance | statistics: can view statistics by task"

## Metrics

```json
{
  "event": "resolved",
  "id": 3,
  "asyncId": 452,
  "triggerAsyncId": 450,
  "executionAsyncId": 450,
  "status": "resolved",
  "createdAt": "2026-09-29T06:30:45.490Z",
  "settledAt": "2026-09-29T06:30:45.505Z",
  "durationMs": 15.42,
  "callSite": {
    "file": "/path/to/test/team_spec.js",
    "line": 5,
    "column": 25,
    "function": "<anonymous>"
  },
  "value": 123
}
```
