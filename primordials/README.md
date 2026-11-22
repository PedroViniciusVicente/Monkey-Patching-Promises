# Primordials Investigation

Command to execute the freeze analysis on Primordials
```bash
node --expose-internals -r internal/test/binding analysis.js
```

Command to execute the normal promise monkey patching
```bash
node promise-monkey-patch.js
```

Command to execute the primordial promise monkey patching (attempt)
```bash
node --expose-internals -r internal/test/binding primordial-monkey-patch_attempt.js
```

<!-- 
Command to execute the monkey-patching on promise.resolve
```bash
node -r ./monkey-patch.js script.js
```

Command to execute monkey-patching on primordials promise.resolve
```bash
node --expose-internals -r internal/test/binding monkey-patch-primordials.js 
```


```bash
node --expose-internals --no-warnings -r ./primordials-poc.js script2.js
```

```bash
node --expose-internals --no-warnings -r ./primordials-poc.js script3.js
``` -->
