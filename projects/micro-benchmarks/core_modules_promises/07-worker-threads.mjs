import { Worker } from 'node:worker_threads'; // https://nodejs.org/api/worker_threads.html#workerterminate

const worker = new Worker('./worker.js');

// await setTimeout(500);
const exitCode = await worker.terminate(); // [returns promise: worker.terminate]
console.log(exitCode);