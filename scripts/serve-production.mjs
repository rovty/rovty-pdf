// Local QA server for built static assets. Worker API tests use Wrangler/Miniflare.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname } from 'node:path';

const root = resolve('dist');
const rules = [];
for (const line of (await readFile(resolve(root, '_headers'), 'utf8')).split('\n')) {
  if (line.trim().startsWith('#')) continue;
  if (line.startsWith('/')) rules.push({ path: line.trim(), headers: {} });
  else if (line.trim()) {
    if (line.trim().startsWith('! ')) {
      rules.at(-1).headers[line.trim().slice(2)] = null;
      continue;
    }
    const colon = line.indexOf(':');
    rules.at(-1).headers[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
}
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
};
createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    let file = resolve(root, pathname === '/' ? 'index.html' : `.${pathname}`);
    let status = 200;
    if (!file.startsWith(`${root}/`) && file !== root) {
      res.writeHead(403).end();
      return;
    }
    let info = await stat(file).catch(() => null);
    if (!info?.isFile() && !extname(file)) {
      const clean = await stat(`${file}.html`).catch(() => null);
      if (clean?.isFile()) {
        file += '.html';
        info = clean;
      }
    }
    if (!info?.isFile()) {
      file = resolve(root, '404.html');
      status = 404;
    }
    const headers = { 'Content-Type': types[extname(file)] || 'application/octet-stream' };
    for (const rule of rules) {
      if (
        rule.path === pathname ||
        (rule.path.endsWith('*') && pathname.startsWith(rule.path.slice(0, -1)))
      ) {
        for (const [key, value] of Object.entries(rule.headers)) {
          if (value === null) delete headers[key];
          else headers[key] = value;
        }
      }
    }
    res.writeHead(status, headers);
    res.end(req.method === 'HEAD' ? undefined : await readFile(file));
  } catch {
    res.writeHead(500).end('Could not serve this asset.');
  }
}).listen(5181, '127.0.0.1', () => console.log('Production QA: http://127.0.0.1:5181'));
