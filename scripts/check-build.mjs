import { readdir, stat, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

async function check(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) await check(path);
    else if ((await stat(path)).size > 25 * 1024 * 1024)
      throw new Error(`${path} exceeds Cloudflare Workers' 25 MiB asset limit.`);
  }
}
await check('dist');
const recoveryFonts = JSON.parse(await readFile('src/lib/recoveryFonts.json', 'utf8'));
for (const { path, sha256 } of Object.values(recoveryFonts)) {
  const bytes = await readFile(`dist${path}`);
  if (createHash('sha256').update(bytes).digest('hex') !== sha256)
    throw new Error(`The pinned recovery font asset is missing or changed: ${path}`);
}
await stat('dist/fonts/latin-modern/v2.005/GUST-FONT-LICENSE.TXT');
for (const file of ['_headers', '_redirects', 'pdfium.wasm', 'fonts/NotoSans-Regular.ttf'])
  await stat(`dist/${file}`);
const headers = await readFile('dist/_headers', 'utf8');
if (!headers.includes("connect-src 'self' blob:"))
  throw new Error('Private-processing CSP is missing.');
console.log('Cloudflare Workers assets and privacy headers verified.');
