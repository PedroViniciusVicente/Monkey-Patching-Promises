const originalResolve = primordials.PromiseResolve;

primordials.PromiseResolve = function patchedResolve(...args) {
  console.log('[monkey-patch] primordials.PromiseResolve called');
  console.log('  value   :', args[0]);

  return Reflect.apply(originalResolve, this, args);
};

console.log('[monkey-patch] primordials.PromiseResolve instrumented.\n');

console.log('Was the original function replaced?', primordials.PromiseResolve !== originalResolve); // true = not replaced



// Experiments
// 1. Test with Promise.resolve
Promise.resolve(1).then(value => {
  console.log('Resolved value:', value);
});

// 2. Test with core modules that use Promise.resolve internally
const readline = require('node:readline/promises'); // https://github.com/nodejs/node/blob/main/lib/readline/promises.js#L30

(async () => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question('What is your name? '); // [returns promise: rl.question]
  console.log('Hello:', answer);
  rl.close();
})();


// Answer:
// pedroubuntu@Aspire-A514-54:~/Desktop/monkey_patching_projects/primordials$ node --expose-internals -r internal/test/binding primordial-monkey-patch_attempt.js
// [monkey-patch] primordials.PromiseResolve instrumented.

// Was the original function replaced? false
// What is your name? (node:11939) internal/test/binding: These APIs are for internal testing only. Do not use them.
// (Use `node --trace-warnings ...` to show where the warning was created)
// Resolved value: 1
// What is your name? abcd
// Hello: abcd