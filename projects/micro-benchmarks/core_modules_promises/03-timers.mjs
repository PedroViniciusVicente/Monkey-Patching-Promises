import { setTimeout } from 'node:timers/promises'; // https://nodejs.org/api/timers.html#timers-promises-api

await setTimeout(1000); // [returns promise: setTimeout]
console.log('One second elapsed');