import { EventEmitter, once } from 'node:events'; // https://nodejs.org/api/events.html#eventsonceemitter-name-options

const emitter = new EventEmitter();

const promise = once(emitter, 'ready'); // [returns promise: once]
emitter.emit('ready', 'completed');
const [result] = await promise;
console.log(result);