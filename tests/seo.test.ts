import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tools } from '../src/lib/catalog';
import { pageMetadata, pageSchema } from '../src/lib/seo';

test('every PDF tool has concise, unique metadata and accurate free-app schema', () => {
  const titles = new Set(),
    descriptions = new Set();
  for (const tool of tools) {
    const meta = pageMetadata(`/${tool.id}`);
    assert.ok(
      meta.description.length >= 90 && meta.description.length <= 170,
      `${tool.id}: ${meta.description.length}`,
    );
    assert.ok(meta.robots.startsWith('index'));
    assert.equal(meta.canonical, `https://pdf.rovty.com/${tool.id}`);
    assert.doesNotMatch(meta.description, /store.*signature|cloudflare|R2/i);
    titles.add(meta.title);
    descriptions.add(meta.description);
    const app = pageSchema(`/${tool.id}`)['@graph'].find(
      (entry) => entry['@type'] === 'SoftwareApplication',
    );
    assert.equal(app?.offers?.price, '0');
  }
  assert.equal(titles.size, tools.length);
  assert.equal(descriptions.size, tools.length);
  for (const path of ['/cloud', '/shared', '/missing-tool'])
    assert.equal(pageMetadata(path).robots, 'noindex, nofollow');
});
