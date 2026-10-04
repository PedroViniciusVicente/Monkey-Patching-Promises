const assert = require('assert');

describe('micro-benchmark tests', () => {
  it('should test async/await with a fetch', async () => {
    const response = await fetch('https://jsonplaceholder.typicode.com/todos/1');
    const data = await response.json();
    assert.strictEqual(data.title, 'delectus aut autem');
  });
});