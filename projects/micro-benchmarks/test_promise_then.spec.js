const assert = require('assert');

describe('micro-benchmark tests', () => {
  it('should test promise.then', async () => {
    const result = await Promise.resolve(1)
      .then((n) => n + 1)
      .then((n) => n * 10);
    assert.strictEqual(result, 20);
  });
});