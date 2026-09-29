import React from 'react';
import { readFile, writeFile } from 'node:fs/promises';
import { renderToString } from 'react-dom/server';
import App from '../src/App';
import { tools } from '../src/lib/catalog';
import { pageMetadata, pageSchema } from '../src/lib/seo';

const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  );
const shell = await readFile('dist/index.html', 'utf8');
const paths = [
  '/',
  '/privacy',
  '/cloud',
  '/shared',
  '/developers',
  ...tools.map((tool) => `/${tool.id}`),
];
for (const path of [...paths, '/404']) {
  const meta = pageMetadata(path);
  let html = shell.replace(
    '<div id="root"></div>',
    `<div id="root">${renderToString(<App initialPath={path} prerender />)}</div>`,
  );
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${escape(meta.title)}</title>`);
  for (const [attribute, key, value] of [
    ['name', 'description', meta.description],
    ['name', 'robots', meta.robots],
    ['property', 'og:title', meta.title],
    ['property', 'og:description', meta.description],
    ['property', 'og:url', meta.canonical],
    ['name', 'twitter:title', meta.title],
    ['name', 'twitter:description', meta.description],
  ]) {
    const pattern = new RegExp(`<meta\\s+${attribute}="${key}"\\s+content="[^"]*"\\s*/?>`);
    const tag = `<meta ${attribute}="${key}" content="${escape(value)}" />`;
    html = pattern.test(html)
      ? html.replace(pattern, tag)
      : html.replace('</head>', `${tag}\n</head>`);
  }
  html = html.replace(/(<link rel="canonical" href=")[^"]*("\s*\/?>)/, `$1${meta.canonical}$2`);
  if (path === '/404') html = html.replace(/<link rel="canonical"[^>]*>/, '');
  else if (!meta.robots.startsWith('noindex'))
    html = html.replace(
      '</head>',
      `<script id="page-schema" type="application/ld+json">${JSON.stringify(pageSchema(path)).replace(/</g, '\\u003c')}</script>\n</head>`,
    );
  await writeFile(path === '/' ? 'dist/index.html' : `dist${path}.html`, html);
}
console.log(`Pre-rendered ${paths.length} public PDF pages and a noindex 404 page.`);
