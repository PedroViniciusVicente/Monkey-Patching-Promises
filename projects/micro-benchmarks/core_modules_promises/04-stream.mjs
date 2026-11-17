import { pipeline } from 'node:stream/promises'; // https://nodejs.org/api/stream.html#streampipelinesource-transforms-destination-options

await pipeline( // [returns promise: pipeline]
    ['Hello, ', 'world using ', 'streams\n'],
    process.stdout
);
