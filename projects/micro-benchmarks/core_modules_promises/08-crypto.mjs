import { webcrypto } from 'node:crypto'; // https://nodejs.org/api/webcrypto.html#subtledigestalgorithm-data

const data = new TextEncoder().encode('Hello World');
const hash = await webcrypto.subtle.digest('SHA-256', data); // [returns promise: webcrypto.subtle.digest]
console.log(hash);