const assert = require('assert');

describe('micro-benchmark tests', () => {
  it('should test a simple async/await', async () => {
    const asyncValue = () => new Promise((resolve) => setTimeout(() => resolve('done!'), 100));

    const result = await asyncValue();
    assert.strictEqual(result, 'done!');
  });
});