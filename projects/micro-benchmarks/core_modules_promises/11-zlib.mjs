import { ZipFile } from 'node:zlib'; // https://nodejs.org/api/zlib.html#static-method-zlibzipfileopenfilename-options

const zip = await ZipFile.open('./archive.zip'); // [returns promise: ZipFile.open]

const entry = await zip.get('file.txt');
const content = await entry.content();

console.log('ZIP opened successfully!');
console.log('File content:', content.toString('utf8'));
await zip.close();

