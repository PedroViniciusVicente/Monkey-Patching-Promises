import { readFile } from 'node:fs/promises'; // https://nodejs.org/api/fs.html#promises-api

const content = await readFile('./01-fs.mjs', 'utf8'); // [returns promise: readFile]
console.log('Content:', content.slice(0, 10));