import { pipeline } from 'node:stream/promises'; // https://nodejs.org/api/stream.html#streams-promises-api

await pipeline( // [returns promise: pipeline]
    ['Hello, ', 'world using ', 'streams\n'],
    process.stdout
);
