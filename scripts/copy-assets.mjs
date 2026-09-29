import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';

await mkdir('public/pdfjs', { recursive: true });
for (const folder of ['cmaps', 'standard_fonts', 'wasm']) {
  await cp(`node_modules/pdfjs-dist/${folder}`, `public/pdfjs/${folder}`, { recursive: true });
}
await cp('node_modules/@embedpdf/pdfium/dist/pdfium.wasm', 'public/pdfium.wasm');
await mkdir('public/licenses', { recursive: true });
for (const [name, file] of Object.entries({
  react: 'react/LICENSE',
  'react-dom': 'react-dom/LICENSE',
  scheduler: 'scheduler/LICENSE',
  pdfium: '@embedpdf/pdfium/LICENSE',
  'pdfium-dependencies': '@embedpdf/pdfium/LICENSE.pdfium',
  pdfjs: 'pdfjs-dist/LICENSE',
  'pdf-lib': 'pdf-lib/LICENSE.md',
  'pdf-lib-standard-fonts': '@pdf-lib/standard-fonts/LICENSE.md',
  'pdf-lib-upng': '@pdf-lib/upng/LICENSE',
  pako: 'pako/LICENSE',
  tslib: 'tslib/LICENSE.txt',
  fflate: 'fflate/LICENSE',
  lucide: 'lucide-react/LICENSE',
  archivo: '@fontsource/archivo/LICENSE',
}))
  await cp(`node_modules/${file}`, `public/licenses/${name}.txt`);
const catalog = await readFile('src/lib/catalog.ts', 'utf8').catch(() => '');
const paths = [
  '/',
  '/privacy',
  '/developers',
  ...Array.from(catalog.matchAll(/id: '([^']+)'/g), (match) => `/${match[1]}`),
];
await writeFile(
  'public/sitemap.xml',
  '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    paths.map((path) => `  <url><loc>https://pdf.rovty.com${path}</loc></url>`).join('\n') +
    '\n</urlset>\n',
);
console.log('PDF engines and fonts copied for same-origin, private processing.');
