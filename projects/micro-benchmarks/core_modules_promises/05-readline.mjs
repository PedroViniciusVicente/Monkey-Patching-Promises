import * as readline from 'node:readline/promises'; // https://nodejs.org/api/readline.html#promises-api

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const answer = await rl.question('What is your name? '); // [returns promise: rl.question]
console.log('Hello:', answer);