import { readdir, stat, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

async function check(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) await check(path);
    else if ((await stat(path)).size > 25 * 1024 * 1024)
      throw new Error(`${path} exceeds Cloudflare Workers' 25 MiB asset limit.`);
  }
}
await check('dist');
const manifest = JSON.parse(await readFile('dist/.vite/manifest.json', 'utf8'));
const entry = Object.keys(manifest).find((key) => manifest[key].isEntry);
if (!entry) throw new Error('Missing application entry point.');
const visited = new Set();
let initialBytes = 0,
  initialGzip = 0;
async function measure(key) {
  if (visited.has(key)) return;
  visited.add(key);
  const chunk = manifest[key];
  const source = await readFile(`dist/${chunk.file}`);
  initialBytes += source.length;
  initialGzip += gzipSync(source).length;
  for (const dependency of chunk.imports || []) await measure(dependency);
}
await measure(entry);
if (initialBytes > 400 * 1024 || initialGzip > 130 * 1024)
  throw new Error(
    'Initial JavaScript exceeds the loading budget. Keep PDF engines behind file selection.',
  );
const assets = await readdir('dist/assets');
const engines = assets.filter((name) => /^pdfium-.*\.wasm$/.test(name));
if (engines.length !== 1 || assets.some((name) => name.endsWith('.woff')))
  throw new Error('Duplicate engine or legacy UI font assets were generated.');
// Build metadata is used only for validation, not served or cached by the app.
await rm('dist/.vite', { recursive: true });
console.log(
  `Initial JavaScript: ${Math.round(initialBytes / 1024)} KiB (${Math.round(initialGzip / 1024)} KiB gzip). One shared PDF engine asset.`,
);
const recoveryFonts = JSON.parse(await readFile('src/lib/recoveryFonts.json', 'utf8'));
for (const { path, sha256 } of Object.values(recoveryFonts)) {
  const bytes = await readFile(`dist${path}`);
  if (createHash('sha256').update(bytes).digest('hex') !== sha256)
    throw new Error(`The pinned recovery font asset is missing or changed: ${path}`);
}
await stat('dist/fonts/latin-modern/v2.005/GUST-FONT-LICENSE.TXT');
for (const file of [
  '_headers',
  '_redirects',
  'font-instance.wasm',
  'fonts/NotoSans-Regular.ttf',
  'fonts/sinhala/NotoSerifSinhala-Regular.ttf',
  'fonts/sinhala/NotoSerifSinhala-Bold.ttf',
  'fonts/sinhala/OFL.txt',
  'fonts/fallback/NotoSerif-Regular.ttf',
  'fonts/fallback/NotoSerif-Bold.ttf',
  'fonts/fallback/NotoSerif-Italic.ttf',
  'fonts/fallback/NotoSerif-BoldItalic.ttf',
  'fonts/fallback/OFL.txt',
  'licenses/harfbuzz.txt',
  'scanner/opencv-5.0.0.js',
  'licenses/opencv.txt',
])
  await stat(`dist/${file}`);
const headers = await readFile('dist/_headers', 'utf8');
if (!headers.includes("connect-src 'self' blob:"))
  throw new Error('Private-processing CSP is missing.');
console.log('Cloudflare Workers assets and privacy headers verified.');
