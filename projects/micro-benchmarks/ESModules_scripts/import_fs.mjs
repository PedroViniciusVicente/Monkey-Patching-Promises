import fs from 'fs/promises';

async function main() {
    const fileContent = await fs.readFile('package.json', 'utf-8');
    const parsed = JSON.parse(fileContent);
    console.log(parsed.name);
}

await main();