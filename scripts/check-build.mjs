import { readdir, stat, readFile } from 'node:fs/promises';

async function check(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) await check(path);
    else if ((await stat(path)).size > 25 * 1024 * 1024)
      throw new Error(`${path} exceeds Cloudflare Pages' 25 MiB asset limit.`);
  }
}
await check('dist');
for (const file of ['_headers', '_redirects', 'pdfium.wasm', 'fonts/NotoSans-Regular.ttf'])
  await stat(`dist/${file}`);
const headers = await readFile('dist/_headers', 'utf8');
if (!headers.includes("connect-src 'self' blob:"))
  throw new Error('Private-processing CSP is missing.');
console.log('Cloudflare Pages assets and privacy headers verified.');
