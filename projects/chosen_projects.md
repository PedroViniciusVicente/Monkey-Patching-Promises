Chosen projects are milo, gutenberg, bare, timed-frontend e flowfuse

### Milo
```
nvm use 20
cd milo
npx wtr --config ./web-test-runner.config.mjs --node-resolve --port=2000 test/utils/logWebVitalsUtils.test.js
```

### Gutenberg
```
nvm use 20
cd gutenberg
npx jest --config test/unit/jest.config.js packages/components/src/tabs/test/index.tsx -t "should continue to handle arrow key navigation properly" --silent
```

### timed-frontend
```
nvm use 14
cd timed-frontend
npx ember test --launch Chrome --filter="Acceptance | statistics: can view statistics by task"
```

### flowfuse
```
nvm use 20
cd flowfuse
npx mocha 'test/unit/forge/routes/api/team_spec.js' --timeout 10000 --node-option=unhandled-rejections=strict -g 'with all instances and their status'
```

<!-- ### bare-http
```
nvm use 22
cd bare-http1

``` -->