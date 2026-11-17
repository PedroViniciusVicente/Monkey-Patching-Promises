import { lookup } from 'node:dns/promises'; // https://nodejs.org/api/dns.html#dns-promises-api

const result = await lookup('nodejs.org'); // [returns promise: lookup]
console.log(result.address);