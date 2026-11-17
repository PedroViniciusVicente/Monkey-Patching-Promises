import assert from 'node:assert/strict'; // https://nodejs.org/api/assert.html#assertrejectsasyncfn-error-message

await assert.rejects( // [returns promise: assert.rejects]
  async () => {
    throw new Error('Expected error');
  },
  {
    message: 'Expected error'
  }
);