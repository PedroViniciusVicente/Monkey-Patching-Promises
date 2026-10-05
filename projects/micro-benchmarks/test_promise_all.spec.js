const assert = require('assert');

describe('micro-benchmark tests', () => {
  it('should test promise.all', async () => {
    const results = await Promise.all([
      new Promise((resolve) => setTimeout(() => resolve('a'), 150)),
      new Promise((resolve) => setTimeout(() => resolve('b'), 100)),
      new Promise((resolve) => setTimeout(() => resolve('c'), 200)),
    ]);
    assert.deepStrictEqual(results, ['a', 'b', 'c']);
  });
});