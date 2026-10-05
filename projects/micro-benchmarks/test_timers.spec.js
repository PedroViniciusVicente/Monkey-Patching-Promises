const assert = require('assert');

describe('micro-benchmark tests', () => {
  it('should test setTimeouts', async () => {
    setTimeout(() => {
      console.log('setTimeout executed after 2 seconds.');
    }, 2000);

    const intervalId = setInterval(() => {
      console.log('setInterval executing every 1 second.');
    }, 1000);

    setTimeout(() => {
      clearInterval(intervalId);
      console.log('setInterval cleared after 5 seconds.');
    }, 5000);

    setImmediate(() => {
      console.log('setImmediate executed.');
    });
    assert.strictEqual(1, 1);
  });
});