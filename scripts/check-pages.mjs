// Verify real HTTP routing, including Pages' automatic clean-URL redirects.
import assert from 'node:assert/strict';
const origin = process.argv[2] || 'http://127.0.0.1:8792';
const sitemapResponse = await fetch(`${origin}/sitemap.xml`);
assert.equal(sitemapResponse.status, 200);
const sitemap = await sitemapResponse.text();
const urls = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => new URL(match[1]));
assert.equal(urls.length, 25);
const titles = new Set();
for (const url of urls) {
  const response = await fetch(origin + url.pathname);
  assert.equal(response.status, 200, url.pathname);
  assert.equal(new URL(response.url).pathname, url.pathname, 'Clean canonical URL');
  const html = await response.text();
  assert.ok(html.includes(`rel="canonical" href="${url.href}"`), url.pathname);
  assert.ok(!html.includes('content="noindex'), url.pathname);
  assert.equal((html.match(/<h1[\s>]/g) || []).length, 1, url.pathname);
  const title = html.match(/<title>(.*?)<\/title>/)?.[1];
  assert.ok(title && !titles.has(title), 'Each public page has a unique title');
  titles.add(title);
  for (const match of html.matchAll(
    /<script[^>]*type="application\/ld\+json"[^>]*>(.*?)<\/script>/gs,
  ))
    JSON.parse(match[1]);
}
for (const path of ['/missing-tool', '/edit/missing-tool']) {
  const response = await fetch(origin + path);
  assert.equal(response.status, 404, path);
  assert.ok((await response.text()).includes('content="noindex, nofollow"'), path);
}
for (const path of ['/edit.html', '/edit/']) {
  const response = await fetch(origin + path);
  assert.equal(response.status, 200, path);
  assert.equal(new URL(response.url).pathname, '/edit', path);
}
console.log(
  `PASS: ${urls.length} public pages, clean URLs, metadata, schemas and noindex 404s through ${origin}.`,
);
