// Primordials
console.log('Primordials', Object.getOwnPropertyDescriptor(primordials, 'PromiseResolve'));
console.log('primordials isFrozen:', Object.isFrozen(primordials)); // isFrozen: não é possível adicionar, remover ou alterar propriedades do objeto

// Global Promise (sem o .prototype, pois resolve é método estático do construtor)
console.log('\nglobalThis.Promise', Object.getOwnPropertyDescriptor(globalThis.Promise, 'resolve'));
console.log('globalThis.Promise isFrozen:', Object.isFrozen(globalThis.Promise));


// pedroubuntu@Aspire-A514-54:~/Desktop/monkey_patching_projects/primordials$ node --expose-internals -r internal/test/binding analysis.js 
// Primordials {
//   value: [Function: bound resolve],
//   writable: false,
//   enumerable: false,
//   configurable: false
// }
// primordials isFrozen: true

// globalThis.Promise {
//   value: [Function: resolve],
//   writable: true,
//   enumerable: false,
//   configurable: true
// }
// globalThis.Promise isFrozen: false

// (node:11284) internal/test/binding: These APIs are for internal testing only. Do not use them.
// (Use `node --trace-warnings ...` to show where the warning was created)