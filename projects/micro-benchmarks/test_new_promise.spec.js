const assert = require('assert');

describe('micro-benchmark tests', () => {
  it('should test new promise', async () => {
    const result = await new Promise.resolve(1);
    assert.strictEqual(result, 1);
  });
});