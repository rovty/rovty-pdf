import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// Workers assets redirect /index.html to /. Cache the canonical response so it can
// also satisfy offline navigations whose redirect mode is "manual".
const assets = ['/', '/favicon.svg'];
async function collect(directory) {
  for (const entry of await readdir(`dist/${directory}`, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await collect(path);
    else assets.push(`/${path}`);
  }
}
for (const directory of ['assets', 'pdfjs', 'fonts']) await collect(directory);
assets.push('/pdfium.wasm');
const hash = createHash('sha256');
for (const asset of assets.sort())
  hash.update(asset).update(await readFile(asset === '/' ? 'dist/index.html' : `dist${asset}`));
const version = hash.digest('hex').slice(0, 16);
const source = `// Generated at build time. Only this explicit list of public app assets is cached.
const CACHE = 'rovty-pdf-app-${version}';
const ASSETS = ${JSON.stringify(assets)};
const paths = new Set(ASSETS);
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    try { await cache.addAll(ASSETS); }
    catch (error) { await caches.delete(CACHE); throw error; }
  })());
});
// Wait for old tabs to close before activating an update; never reload an open PDF.
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('rovty-pdf-app-') && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  // Cloud sessions, shared documents and API responses never use app caches.
  if (url.pathname.startsWith('/api/') || ['/cloud', '/shared'].includes(url.pathname.replace(/\\/$/, ''))) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(async () => (await caches.match('/', {cacheName:CACHE})) || Response.error()));
  } else if (paths.has(url.pathname) && !url.search) {
    event.respondWith(caches.match(request, {cacheName:CACHE}).then(cached => cached || fetch(request)));
  }
});
`;
await writeFile('dist/sw.js', source);
console.log(
  `Optional offline cache: ${assets.length} public assets. Documents and signatures are never included.`,
);
