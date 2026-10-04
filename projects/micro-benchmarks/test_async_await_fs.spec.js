const assert = require('assert');
const fs = require('fs/promises');

describe('micro-benchmark tests', () => {
  it('should test a fs.readFile', async () => {
    const fileContent = await fs.readFile('package.json', 'utf-8');
    const parsed = JSON.parse(fileContent);

    assert.ok(parsed.name);
  });
});