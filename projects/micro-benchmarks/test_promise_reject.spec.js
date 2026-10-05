const assert = require('assert');

describe('micro-benchmark tests', () => {
  it('should test promise reject', async () => {
    const result = await Promise.reject(new Error('test error'));
    assert.fail('Expected promise to be rejected');
  });
});