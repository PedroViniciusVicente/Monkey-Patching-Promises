const assert = require('assert');
const fs = require('fs/promises');

describe('micro-benchmark tests', () => {
  it('should test a race with fs.readFile, fetch and promise', async () => {
    const [result1, result2, result3] = await Promise.all([
    fetch('https://jsonplaceholder.typicode.com/todos/1'),
    fs.readFile('package.json', 'utf-8'),
    new Promise((resolve) => setTimeout(() => resolve('done!'), 100)),
    ]);

   assert.strictEqual(result1.status, 200); 
  });
});