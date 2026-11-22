const originalResolve = Promise.resolve;

Promise.resolve = function patchedResolve(...args) {
  console.log('[monkey-patch] Promise.resolve called');
  console.log('  value   :', args[0]);

  return Reflect.apply(originalResolve, this, args);
};

console.log('[monkey-patch] Promise.resolve instrumented.\n');

console.log('Was the original function replaced?', Promise.resolve !== originalResolve); // true = not replaced


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
// pedroubuntu@Aspire-A514-54:~/Desktop/monkey_patching_projects/primordials$ node promise-monkey-patch.js 
// Was the original function replaced? true
// [monkey-patch] Promise.resolve instrumented with success.

// [monkey-patch] Promise.resolve called
//   value   : 1
// What is your name? Resolved value: 1
// aaaa
// Hello: aaaa